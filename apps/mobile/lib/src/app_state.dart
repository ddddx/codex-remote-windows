import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'models.dart';
import 'native_bridge.dart';

class CodexAppState extends ChangeNotifier {
  CodexAppState(this.bridge);

  final NativeBridge bridge;
  CodexApi? _api;
  CodexSocket? _socket;
  StreamSubscription<JsonMap>? _messageSub;
  StreamSubscription<String>? _statusSub;
  Timer? _workingTimer;

  String serverUrl = 'http://127.0.0.1:18637';
  String token = '';
  String cookie = '';
  String deviceId = '';
  String connectionStatus = 'idle';
  String healthStatus = 'idle';
  String errorMessage = '';
  String activeSessionId = '';
  String theme = 'paper';
  String workspacePath = '';
  WorkspaceListing? workspaceListing;
  List<SessionItem> sessions = [];
  List<ServerRequestItem> approvals = [];
  List<JsonMap> notices = [];
  List<CodexModelOption> modelOptions = [];
  ComposerPrefs defaultPrefs = const ComposerPrefs();
  Map<String, ComposerPrefs> prefsByThread = {};
  Map<String, List<TimelineEntry>> timelineByThread = {};
  Map<String, List<AttachmentItem>> attachmentsByThread = {};
  Map<String, JsonMap> tokenUsageByThread = {};
  Map<String, int> activeTurnStartedAt = {};
  bool controlsExpanded = false;
  bool busy = false;

  CodexApi get api {
    final current = _api;
    if (current == null) {
      throw StateError('API not configured');
    }
    return current;
  }

  SessionItem? get activeSession {
    for (final session in sessions) {
      if (session.threadId == activeSessionId) {
        return session;
      }
    }
    return null;
  }

  ComposerPrefs get activePrefs {
    return prefsByThread[activeSessionId] ?? _prefsFromSession(activeSession) ?? defaultPrefs;
  }

  List<TimelineEntry> get activeTimeline => timelineByThread[activeSessionId] ?? const [];
  List<AttachmentItem> get activeAttachments => attachmentsByThread[activeSessionId] ?? const [];
  JsonMap? get activeTokenUsage => tokenUsageByThread[activeSessionId] ?? activeSession?.tokenUsage;

  bool get isConfigured => serverUrl.trim().isNotEmpty && token.trim().isNotEmpty;
  bool get isConnected => connectionStatus == 'connected';
  bool get isWorking => activeTurnStartedAt.containsKey(activeSessionId);

  String get workingLabel {
    final startedAt = activeTurnStartedAt[activeSessionId];
    if (startedAt == null) {
      return '';
    }
    final elapsed = max(0, DateTime.now().millisecondsSinceEpoch - startedAt);
    final seconds = elapsed ~/ 1000;
    if (seconds < 60) {
      return 'Working · ${seconds}s';
    }
    return 'Working · ${seconds ~/ 60}m ${(seconds % 60).toString().padLeft(2, '0')}s';
  }

  Future<void> initialize() async {
    serverUrl = await bridge.getString('serverUrl') ?? serverUrl;
    token = await bridge.getString('token') ?? '';
    cookie = await bridge.getString('cookie') ?? '';
    activeSessionId = await bridge.getString('activeSessionId') ?? '';
    theme = await bridge.getString('theme') ?? 'paper';
    deviceId = await bridge.getString('deviceId') ?? '';
    if (deviceId.isEmpty) {
      deviceId = 'android-${DateTime.now().millisecondsSinceEpoch}-${Random().nextInt(999999)}';
      await bridge.setString('deviceId', deviceId);
    }
    _configureApi();
    await refreshHealth();
    if (token.isNotEmpty && cookie.isNotEmpty) {
      await connectSocket();
      unawaited(loadCodexOptions());
      unawaited(loadWorkspace());
    }
  }

  void updateServerDraft(String value) {
    serverUrl = value;
    notifyListeners();
  }

  void updateTokenDraft(String value) {
    token = value;
    notifyListeners();
  }

  void setTheme(String value) {
    theme = value;
    unawaited(bridge.setString('theme', value));
    notifyListeners();
  }

  void clearError() {
    errorMessage = '';
    notifyListeners();
  }

  Future<void> login() async {
    busy = true;
    errorMessage = '';
    notifyListeners();
    try {
      _configureApi();
      final response = await api.postJson('/api/auth/session', {
        'token': token,
        'deviceName': 'Android App',
        'deviceId': deviceId,
      }, token: token);
      cookie = api.cookie;
      if (cookie.isEmpty) {
        throw ApiException('服务没有返回登录 Cookie');
      }
      await bridge.setString('serverUrl', serverUrl);
      await bridge.setString('token', token);
      await bridge.setString('cookie', cookie);
      final session = response['session'];
      if (session is JsonMap) {
        notices.insert(0, {'level': 'info', 'title': '已登录', 'message': readString(session, 'deviceName', 'Android App')});
      }
      await connectSocket();
      await refreshHealth();
      await loadCodexOptions();
      await loadWorkspace();
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _socket?.close();
    cookie = '';
    sessions = [];
    activeSessionId = '';
    approvals = [];
    timelineByThread.clear();
    attachmentsByThread.clear();
    await bridge.remove('cookie');
    await bridge.remove('activeSessionId');
    notifyListeners();
  }

  Future<void> refreshHealth() async {
    healthStatus = 'loading';
    notifyListeners();
    try {
      final payload = await api.getJson('/health');
      healthStatus = readString(payload, 'status', 'ok');
    } catch (error) {
      healthStatus = 'error';
      errorMessage = error.toString();
    }
    notifyListeners();
  }

  Future<void> loadCodexOptions() async {
    try {
      final payload = await api.getJson('/api/codex/options', query: workspacePath.isEmpty ? const {} : {'cwd': workspacePath});
      final models = payload['models'];
      modelOptions = models is List ? models.whereType<JsonMap>().map(CodexModelOption.fromJson).toList() : [];
      final defaults = payload['defaults'];
      if (defaults is JsonMap) {
        defaultPrefs = ComposerPrefs(
          model: readString(defaults, 'model'),
          reasoningEffort: readString(defaults, 'reasoningEffort', 'medium'),
          approvalPolicy: readString(defaults, 'approvalPolicy', 'on-request'),
          sandboxMode: readString(defaults, 'sandboxMode', 'workspace-write'),
        );
      }
    } catch (error) {
      errorMessage = error.toString();
    }
    notifyListeners();
  }

  Future<void> loadWorkspace([String? path]) async {
    try {
      final shortcuts = await api.getJson('/api/workspace/shortcuts');
      final selected = path ?? workspacePath.ifEmpty(readString(shortcuts, 'preferredPath'));
      workspacePath = selected;
      final listing = await api.getJson('/api/workspace/list', query: selected.isEmpty ? const {} : {'path': selected});
      workspaceListing = WorkspaceListing.fromJson(listing);
      workspacePath = workspaceListing?.path ?? selected;
    } catch (error) {
      errorMessage = error.toString();
    }
    notifyListeners();
  }

  Future<void> createWorkspaceFolder(String name) async {
    final parent = workspaceListing?.path ?? workspacePath;
    if (parent.isEmpty || name.trim().isEmpty) {
      return;
    }
    try {
      final created = await api.postJson('/api/workspace/create-directory', {
        'parentPath': parent,
        'folderName': name.trim(),
      });
      await loadWorkspace(readString(created, 'path', parent));
    } catch (error) {
      errorMessage = error.toString();
      notifyListeners();
    }
  }

  Future<void> connectSocket() async {
    await _socket?.dispose();
    await _messageSub?.cancel();
    await _statusSub?.cancel();
    _configureApi();
    final socket = CodexSocket(api);
    _socket = socket;
    _messageSub = socket.messages.listen(handleServerMessage);
    _statusSub = socket.status.listen((status) {
      connectionStatus = status;
      notifyListeners();
    });
    await socket.connect();
  }

  void selectSession(String threadId) {
    activeSessionId = threadId;
    unawaited(bridge.setString('activeSessionId', threadId));
    _socket?.send({'type': 'thread_sync', 'threadId': threadId});
    notifyListeners();
  }

  Future<void> createSession({required String name, required String cwd}) async {
    final prefs = activePrefs;
    _socket?.send({
      'type': 'tab_create',
      'name': name,
      'cwd': cwd,
      if (prefs.model.isNotEmpty) 'model': prefs.model,
      'effort': prefs.reasoningEffort,
      'approvalPolicy': prefs.approvalPolicy,
      'sandboxMode': prefs.sandboxMode,
    });
  }

  void closeSession(String threadId) {
    _socket?.send({'type': 'tab_close', 'threadId': threadId});
  }

  void updatePrefs(ComposerPrefs prefs) {
    if (activeSessionId.isEmpty) {
      defaultPrefs = prefs;
      notifyListeners();
      return;
    }
    prefsByThread[activeSessionId] = prefs;
    _socket?.send({
      'type': 'thread_options_update',
      'threadId': activeSessionId,
      if (prefs.model.isNotEmpty) 'model': prefs.model,
      'effort': prefs.reasoningEffort,
      'approvalPolicy': prefs.approvalPolicy,
      'sandboxMode': prefs.sandboxMode,
    });
    notifyListeners();
  }

  void applyPermissionPreset(String preset) {
    final current = activePrefs;
    if (preset == 'read-only') {
      updatePrefs(current.copyWith(approvalPolicy: 'on-request', sandboxMode: 'read-only'));
    } else if (preset == 'full-access') {
      updatePrefs(current.copyWith(approvalPolicy: 'never', sandboxMode: 'danger-full-access'));
    } else {
      updatePrefs(current.copyWith(approvalPolicy: 'on-request', sandboxMode: 'workspace-write'));
    }
  }

  Future<void> sendPrompt(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || activeSessionId.isEmpty) {
      return;
    }
    final now = DateTime.now().millisecondsSinceEpoch;
    _appendEntry(activeSessionId, TimelineEntry(
      id: 'local-user-$now',
      type: 'message',
      title: '你',
      text: trimmed,
      createdAt: now,
    ));
    if (trimmed.startsWith('/') || trimmed.startsWith('!')) {
      _socket?.send({
        'type': 'command_send',
        'threadId': activeSessionId,
        'text': trimmed,
        'clientMessageId': 'mobile-$now',
      });
      notifyListeners();
      return;
    }
    final prefs = activePrefs;
    final attachments = activeAttachments.map((item) => {'path': item.filePath, 'name': item.name}).toList(growable: false);
    attachmentsByThread[activeSessionId] = [];
    _socket?.send({
      'type': 'turn_send',
      'threadId': activeSessionId,
      'text': trimmed,
      'attachments': attachments,
      'clientMessageId': 'mobile-$now',
      if (prefs.model.isNotEmpty) 'model': prefs.model,
      'effort': prefs.reasoningEffort,
      'approvalPolicy': prefs.approvalPolicy,
      'sandboxMode': prefs.sandboxMode,
    });
    notifyListeners();
  }

  Future<void> pickAndUploadImage() async {
    if (activeSessionId.isEmpty) {
      return;
    }
    try {
      final picked = await bridge.pickImage();
      if (picked == null) {
        return;
      }
      final uploaded = await api.uploadImage(
        bytes: picked.bytes,
        fileName: picked.name,
        contentType: picked.mimeType,
      );
      final item = AttachmentItem.fromJson(uploaded);
      final list = [...activeAttachments, item];
      attachmentsByThread[activeSessionId] = list;
    } catch (error) {
      errorMessage = error.toString();
    }
    notifyListeners();
  }

  void removeAttachment(String id) {
    attachmentsByThread[activeSessionId] = activeAttachments.where((item) => item.id != id).toList(growable: false);
    notifyListeners();
  }

  void respondApproval(ServerRequestItem request, dynamic response) {
    _socket?.send({
      'type': 'server_request_respond',
      'requestId': request.requestId,
      'response': response,
    });
    approvals = approvals.map((item) {
      if (item.requestId == request.requestId) {
        final next = JsonMap.from(item.raw);
        next['status'] = 'submitting';
        return ServerRequestItem(next);
      }
      return item;
    }).toList(growable: false);
    notifyListeners();
  }

  void dismissNotice(int index) {
    if (index < 0 || index >= notices.length) {
      return;
    }
    notices.removeAt(index);
    notifyListeners();
  }

  void toggleControls() {
    controlsExpanded = !controlsExpanded;
    notifyListeners();
  }

  void handleServerMessage(JsonMap message) {
    final type = readString(message, 'type');
    switch (type) {
      case 'state':
        _replaceSessions(message['tabs']);
        _replaceApprovals(message['serverRequests']);
        _replaceGlobalNotices(message['globalSupplementalItems']);
        break;
      case 'tab_created':
        final tab = message['tab'];
        if (tab is JsonMap) {
          _upsertSession(SessionItem.fromJson(tab));
          selectSession(readString(message, 'threadId', readString(tab, 'threadId')));
        }
        break;
      case 'tab_updated':
        final tab = message['tab'];
        if (tab is JsonMap) {
          _upsertSession(SessionItem.fromJson(tab));
        }
        break;
      case 'tab_removed':
        sessions = sessions.where((item) => item.threadId != readString(message, 'threadId')).toList(growable: false);
        break;
      case 'thread_sync':
        _applyThreadSync(message);
        break;
      case 'server_request_required':
      case 'server_request_updated':
        final request = message['request'];
        if (request is JsonMap) {
          _upsertApproval(ServerRequestItem(request));
        }
        break;
      case 'server_request_resolved':
        approvals = approvals.where((item) => item.requestId != readString(message, 'requestId')).toList(growable: false);
        break;
      case 'server_request_reset':
        approvals = [];
        break;
      case 'turn_started':
        _setTurnStarted(readString(message, 'threadId'), readString(message, 'turnId'), readInt(message, 'startedAt'));
        break;
      case 'turn_completed':
        activeTurnStartedAt.remove(readString(message, 'threadId'));
        break;
      case 'agent_delta':
        _appendAgentDelta(message);
        break;
      case 'plan_delta':
        _appendEntry(readString(message, 'threadId'), TimelineEntry(
          id: _eventId(message),
          type: 'plan',
          title: '执行计划',
          text: readString(message, 'delta'),
          turnId: readString(message, 'turnId'),
          itemId: readString(message, 'itemId'),
          createdAt: _eventTime(message),
          partial: true,
        ));
        break;
      case 'turn_plan_updated':
        _appendPlan(message);
        break;
      case 'item_started':
      case 'item_completed':
      case 'item_delta':
      case 'thread_event':
      case 'hook_started':
      case 'hook_completed':
      case 'guardian_review_started':
      case 'guardian_review_completed':
      case 'mcp_tool_progress':
      case 'turn_diff_updated':
        _appendGenericEvent(message);
        break;
      case 'token_usage':
        final threadId = readString(message, 'threadId');
        final usage = message['usage'];
        if (threadId.isNotEmpty && usage is JsonMap) {
          tokenUsageByThread[threadId] = usage;
        }
        break;
      case 'warning':
      case 'error_notice':
      case 'backend_error':
      case 'error':
        notices.insert(0, {
          'level': type == 'error' || type == 'error_notice' || type == 'backend_error' ? 'error' : 'warning',
          'title': type == 'backend_error' ? '服务错误' : type,
          'message': readString(message, 'message', jsonEncode(message)),
        });
        break;
      case 'notification':
        _handleNotification(message);
        break;
    }
    notifyListeners();
  }

  void _configureApi() {
    _api?.close();
    _api = CodexApi(baseUrl: serverUrl, cookie: cookie);
  }

  void _replaceSessions(dynamic value) {
    if (value is! List) {
      sessions = [];
      return;
    }
    sessions = value.whereType<JsonMap>().map(SessionItem.fromJson).where((item) => item.threadId.isNotEmpty).toList(growable: false);
    if (activeSessionId.isEmpty && sessions.isNotEmpty) {
      activeSessionId = sessions.first.threadId;
      unawaited(bridge.setString('activeSessionId', activeSessionId));
    }
    for (final session in sessions) {
      prefsByThread.putIfAbsent(session.threadId, () => _prefsFromSession(session) ?? defaultPrefs);
      if (session.tokenUsage != null) {
        tokenUsageByThread[session.threadId] = session.tokenUsage!;
      }
    }
  }

  void _replaceApprovals(dynamic value) {
    approvals = value is List ? value.whereType<JsonMap>().map(ServerRequestItem.new).toList(growable: false) : [];
  }

  void _replaceGlobalNotices(dynamic value) {
    if (value is! List) {
      return;
    }
    notices = value.whereType<JsonMap>().map((item) => {
      'level': readString(item, 'noticeKind', 'info'),
      'title': readString(item, 'type', '通知'),
      'message': readString(item, 'text'),
    }).toList(growable: true);
  }

  void _upsertSession(SessionItem session) {
    if (session.threadId.isEmpty) {
      return;
    }
    final next = [...sessions];
    final index = next.indexWhere((item) => item.threadId == session.threadId);
    if (index >= 0) {
      next[index] = session;
    } else {
      next.insert(0, session);
    }
    sessions = next;
    prefsByThread.putIfAbsent(session.threadId, () => _prefsFromSession(session) ?? defaultPrefs);
    if (session.tokenUsage != null) {
      tokenUsageByThread[session.threadId] = session.tokenUsage!;
    }
  }

  void _upsertApproval(ServerRequestItem request) {
    if (request.requestId.isEmpty) {
      return;
    }
    final next = [...approvals];
    final index = next.indexWhere((item) => item.requestId == request.requestId);
    if (index >= 0) {
      next[index] = request;
    } else {
      next.insert(0, request);
    }
    approvals = next;
  }

  void _applyThreadSync(JsonMap message) {
    final threadId = readString(message, 'threadId');
    if (threadId.isEmpty) {
      return;
    }
    final entries = <TimelineEntry>[];
    final turns = message['turns'];
    if (turns is List) {
      for (final rawTurn in turns.whereType<JsonMap>()) {
        entries.addAll(_entriesFromTurn(rawTurn));
      }
    }
    final events = message['timelineEvents'];
    if (events is List) {
      for (final event in events.whereType<JsonMap>()) {
        entries.add(_entryFromEvent(event));
      }
    }
    entries.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    timelineByThread[threadId] = _dedupeEntries(entries);
    final usage = message['tokenUsage'];
    if (usage is JsonMap) {
      tokenUsageByThread[threadId] = usage;
    }
    _restoreActiveTurn(threadId, turns);
  }

  List<TimelineEntry> _entriesFromTurn(JsonMap turn) {
    final threadEntries = <TimelineEntry>[];
    final turnId = readString(turn, 'id');
    final startedAt = readInt(turn, 'startedAt', readInt(turn, 'createdAt'));
    final inputText = _extractText(turn['input']);
    if (inputText.isNotEmpty) {
      threadEntries.add(TimelineEntry(
        id: 'turn-$turnId-user',
        type: 'message',
        title: '你',
        text: inputText,
        turnId: turnId,
        createdAt: startedAt,
      ));
    }
    final items = turn['items'];
    if (items is List) {
      for (final item in items.whereType<JsonMap>()) {
        threadEntries.add(_entryFromItem(item, turnId, startedAt));
      }
    }
    final outputText = _extractText(turn['output']);
    if (outputText.isNotEmpty) {
      threadEntries.add(TimelineEntry(
        id: 'turn-$turnId-assistant',
        type: 'message',
        title: 'Codex',
        text: outputText,
        turnId: turnId,
        createdAt: readInt(turn, 'completedAt', startedAt + 1),
      ));
    }
    return threadEntries;
  }

  TimelineEntry _entryFromItem(JsonMap item, String turnId, int fallbackTime) {
    final type = readString(item, 'type');
    final id = readString(item, 'id', 'item-$turnId-${timelineByThread.length}-${Random().nextInt(99999)}');
    final status = readString(item, 'status');
    final title = _itemTitle(type, item);
    final text = _itemText(item);
    return TimelineEntry(
      id: id,
      type: type,
      title: title,
      text: text,
      status: status,
      turnId: turnId,
      itemId: id,
      patch: readString(item, 'patch'),
      createdAt: readInt(item, 'startedAt', fallbackTime),
      raw: item,
    );
  }

  TimelineEntry _entryFromEvent(JsonMap event) {
    final type = readString(event, 'type');
    if (type == 'agent_delta') {
      return TimelineEntry(
        id: _eventId(event),
        type: 'message',
        title: 'Codex',
        text: readString(event, 'delta'),
        turnId: readString(event, 'turnId'),
        itemId: readString(event, 'itemId'),
        createdAt: _eventTime(event),
        partial: true,
        raw: event,
      );
    }
    return TimelineEntry(
      id: _eventId(event),
      type: type,
      title: _eventTitle(event),
      text: _eventText(event),
      status: readString(event, 'status', 'running'),
      turnId: readString(event, 'turnId'),
      itemId: readString(event, 'itemId'),
      patch: readString(event, 'patch'),
      createdAt: _eventTime(event),
      raw: event,
    );
  }

  void _setTurnStarted(String threadId, String turnId, int startedAt) {
    if (threadId.isEmpty) {
      return;
    }
    activeTurnStartedAt[threadId] = _normalizeTimestamp(startedAt);
    _startWorkingTimer();
  }

  void _restoreActiveTurn(String threadId, dynamic turns) {
    if (turns is! List) {
      return;
    }
    for (final rawTurn in turns.reversed.whereType<JsonMap>()) {
      final status = readString(rawTurn, 'status');
      if (status == 'in_progress' || status == 'running') {
        activeTurnStartedAt[threadId] = _normalizeTimestamp(readInt(rawTurn, 'startedAt'));
        _startWorkingTimer();
        return;
      }
    }
    activeTurnStartedAt.remove(threadId);
  }

  void _appendAgentDelta(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final itemId = readString(event, 'itemId', readString(event, 'turnId', 'assistant'));
    final delta = readString(event, 'delta');
    if (threadId.isEmpty || delta.isEmpty) {
      return;
    }
    final entries = [...(timelineByThread[threadId] ?? const <TimelineEntry>[])];
    final index = entries.indexWhere((entry) => entry.type == 'message' && entry.itemId == itemId && entry.title == 'Codex');
    if (index >= 0) {
      entries[index] = entries[index].copyWith(text: entries[index].text + delta, partial: true);
    } else {
      entries.add(TimelineEntry(
        id: 'agent-$itemId',
        type: 'message',
        title: 'Codex',
        text: delta,
        turnId: readString(event, 'turnId'),
        itemId: itemId,
        createdAt: _eventTime(event),
        partial: true,
      ));
    }
    timelineByThread[threadId] = entries;
  }

  void _appendPlan(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final plan = event['plan'];
    final steps = plan is List
        ? plan.whereType<JsonMap>().map((item) => '${readString(item, 'status')} · ${readString(item, 'step')}').join('\n')
        : '';
    _appendEntry(threadId, TimelineEntry(
      id: _eventId(event),
      type: 'plan',
      title: '执行计划',
      text: [readString(event, 'explanation'), steps].where((item) => item.isNotEmpty).join('\n'),
      turnId: readString(event, 'turnId'),
      createdAt: _eventTime(event),
      raw: event,
    ));
  }

  void _appendGenericEvent(JsonMap event) {
    final threadId = readString(event, 'threadId');
    _appendEntry(threadId, _entryFromEvent(event));
  }

  void _appendEntry(String threadId, TimelineEntry entry) {
    if (threadId.isEmpty) {
      return;
    }
    final entries = [...(timelineByThread[threadId] ?? const <TimelineEntry>[])];
    final index = entries.indexWhere((item) => item.id == entry.id);
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.add(entry);
    }
    entries.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    timelineByThread[threadId] = entries;
  }

  void _handleNotification(JsonMap message) {
    final method = readString(message, 'method');
    final params = message['params'];
    if (method == 'account/rateLimits/updated' || method == 'skills/changed' || method == 'thread/settings/updated') {
      return;
    }
    notices.insert(0, {
      'level': 'info',
      'title': _notificationTitle(method),
      'message': params is JsonMap ? _summarizeMap(params) : params?.toString() ?? method,
    });
  }

  void _startWorkingTimer() {
    _workingTimer ??= Timer.periodic(const Duration(seconds: 1), (_) => notifyListeners());
  }

  List<TimelineEntry> _dedupeEntries(List<TimelineEntry> entries) {
    final byId = <String, TimelineEntry>{};
    for (final entry in entries) {
      byId[entry.id] = entry;
    }
    return byId.values.toList(growable: false)..sort((a, b) => a.createdAt.compareTo(b.createdAt));
  }

  ComposerPrefs? _prefsFromSession(SessionItem? session) {
    if (session == null) {
      return null;
    }
    if (session.model.isEmpty && session.reasoningEffort.isEmpty && session.approvalPolicy.isEmpty && session.sandboxMode.isEmpty) {
      return null;
    }
    return ComposerPrefs(
      model: session.model,
      reasoningEffort: session.reasoningEffort.ifEmpty(defaultPrefs.reasoningEffort),
      approvalPolicy: session.approvalPolicy.ifEmpty(defaultPrefs.approvalPolicy),
      sandboxMode: session.sandboxMode.ifEmpty(defaultPrefs.sandboxMode),
    );
  }

  int _normalizeTimestamp(int value) {
    if (value <= 0) {
      return DateTime.now().millisecondsSinceEpoch;
    }
    return value < 100000000000 ? value * 1000 : value;
  }

  int _eventTime(JsonMap event) => _normalizeTimestamp(readInt(event, 'startedAt', readInt(event, 'createdAt', DateTime.now().millisecondsSinceEpoch)));

  String _eventId(JsonMap event) {
    final type = readString(event, 'type');
    final itemId = readString(event, 'itemId');
    final turnId = readString(event, 'turnId');
    return [type, turnId, itemId, _eventTime(event).toString()].where((item) => item.isNotEmpty).join('-');
  }

  String _eventTitle(JsonMap event) {
    final type = readString(event, 'type');
    if (type == 'item_started' || type == 'item_completed') {
      final item = event['item'];
      if (item is JsonMap) {
        return _itemTitle(readString(item, 'type'), item);
      }
    }
    const labels = {
      'item_delta': '输出更新',
      'mcp_tool_progress': 'MCP 工具',
      'turn_diff_updated': '轮次 Diff',
      'thread_event': '线程事件',
      'hook_started': 'Hook 开始',
      'hook_completed': 'Hook 完成',
      'guardian_review_started': '审查开始',
      'guardian_review_completed': '审查完成',
    };
    return labels[type] ?? type;
  }

  String _eventText(JsonMap event) {
    final item = event['item'];
    if (item is JsonMap) {
      return _itemText(item);
    }
    return readString(event, 'message')
        .ifEmpty(readString(event, 'delta'))
        .ifEmpty(readString(event, 'patch'))
        .ifEmpty(event['params'] is JsonMap ? _summarizeMap(event['params'] as JsonMap) : '');
  }

  String _itemTitle(String type, JsonMap item) {
    if (type == 'commandExecution') {
      return '命令';
    }
    if (type == 'fileChange') {
      return '文件变更';
    }
    if (type == 'reasoning') {
      return '思考';
    }
    if (type == 'agentMessage') {
      return 'Codex';
    }
    if (type == 'userMessage') {
      return '你';
    }
    return type.ifEmpty(readString(item, 'id', '事件'));
  }

  String _itemText(JsonMap item) {
    return readString(item, 'text')
        .ifEmpty(readString(item, 'command'))
        .ifEmpty(readString(item, 'message'))
        .ifEmpty(readString(item, 'patch'))
        .ifEmpty(_extractText(item['content']))
        .ifEmpty(readString(item, 'id'));
  }

  String _extractText(dynamic value) {
    if (value == null) {
      return '';
    }
    if (value is String) {
      return value;
    }
    if (value is List) {
      return value.map(_extractText).where((item) => item.trim().isNotEmpty).join('\n');
    }
    if (value is JsonMap) {
      for (final key in ['text', 'message', 'content', 'input', 'summary']) {
        final extracted = _extractText(value[key]);
        if (extracted.isNotEmpty) {
          return extracted;
        }
      }
      return _summarizeMap(value);
    }
    return value.toString();
  }

  String _notificationTitle(String method) {
    if (method == 'mcpServer/startupStatus/updated') {
      return 'MCP 服务状态';
    }
    if (method == 'guardianWarning') {
      return 'Guardian 警告';
    }
    if (method == 'configWarning') {
      return '配置警告';
    }
    if (method == 'deprecated') {
      return '弃用通知';
    }
    return method;
  }

  String _summarizeMap(JsonMap map) {
    return map.entries
        .where((entry) => entry.value != null)
        .map((entry) => '${entry.key}: ${entry.value}')
        .take(4)
        .join(' · ');
  }

  @override
  void dispose() {
    _workingTimer?.cancel();
    unawaited(_messageSub?.cancel());
    unawaited(_statusSub?.cancel());
    unawaited(_socket?.dispose());
    _api?.close();
    super.dispose();
  }
}

extension _StringFallback on String {
  String ifEmpty(String fallback) => isEmpty ? fallback : this;
}
