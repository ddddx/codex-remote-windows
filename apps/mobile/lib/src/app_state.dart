import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'models.dart';
import 'native_bridge.dart';

const String githubReleaseApiUrl =
    'https://api.github.com/repos/ddddx/codex-remote-windows/releases/latest';
const String githubReleasePageUrl =
    'https://github.com/ddddx/codex-remote-windows/releases';
const String githubLatestReleasePageUrl =
    'https://github.com/ddddx/codex-remote-windows/releases/latest';
const int defaultUpdateDownloadConnectionLimit = 4;
const int maxUpdateDownloadConnectionLimit = 64;

class MobileUpdateInfo {
  const MobileUpdateInfo({
    required this.versionName,
    required this.tagName,
    required this.releaseUrl,
    required this.apkName,
    required this.apkUrl,
  });

  final String versionName;
  final String tagName;
  final String releaseUrl;
  final String apkName;
  final String apkUrl;
}

class CodexAppState extends ChangeNotifier {
  CodexAppState(this.bridge) {
    _downloadProgressSub = bridge.downloadProgress.listen(
      _handleDownloadProgress,
    );
  }

  final NativeBridge bridge;
  CodexApi? _api;
  CodexSocket? _socket;
  StreamSubscription<JsonMap>? _messageSub;
  StreamSubscription<String>? _statusSub;
  StreamSubscription<UpdateDownloadProgress>? _downloadProgressSub;
  Timer? _workingTimer;
  bool _reauthenticating = false;
  final Set<String> _completedTurnNotifications = {};

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
  String packageName = '';
  String appVersionName = '';
  int appVersionCode = 0;
  bool updateChecking = false;
  bool updateDownloading = false;
  double updateDownloadProgress = 0;
  int updateDownloadedBytes = 0;
  int updateTotalBytes = 0;
  int updateDownloadBytesPerSecond = 0;
  bool updateDownloadAccelerated = false;
  int updateDownloadConnections = 1;
  int updateDownloadConnectionLimit = defaultUpdateDownloadConnectionLimit;
  String updateDownloadStage = '';
  bool updateReadyToInstall = false;
  String updateDownloadedApkName = '';
  bool backgroundKeepAliveActive = false;
  bool appInForeground = true;
  String updateMessage = '';
  MobileUpdateInfo? availableUpdate;
  WorkspaceListing? workspaceListing;
  List<SessionItem> sessions = [];
  List<AuthSessionItem> authSessions = [];
  List<ServerRequestItem> approvals = [];
  List<JsonMap> notices = [];
  List<CodexModelOption> modelOptions = [];
  ComposerPrefs defaultPrefs = const ComposerPrefs();
  Map<String, ComposerPrefs> prefsByThread = {};
  Map<String, List<TimelineEntry>> timelineByThread = {};
  Map<String, List<AttachmentItem>> attachmentsByThread = {};
  Map<String, JsonMap> tokenUsageByThread = {};
  Map<String, int> activeTurnStartedAt = {};
  Set<String> dismissedNoticeKeys = {};
  Set<String> unreadThreadIds = {};
  bool controlsExpanded = false;
  bool busy = false;
  bool authSessionsLoading = false;

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
    return prefsByThread[activeSessionId] ??
        _prefsFromSession(activeSession) ??
        defaultPrefs;
  }

  List<TimelineEntry> get activeTimeline =>
      timelineByThread[activeSessionId] ?? const [];
  List<AttachmentItem> get activeAttachments =>
      attachmentsByThread[activeSessionId] ?? const [];
  JsonMap? get activeTokenUsage =>
      tokenUsageByThread[activeSessionId] ?? activeSession?.tokenUsage;

  bool get requiresSetup => cookie.isEmpty || _usesAndroidLoopbackServerUrl();
  bool get isConfigured =>
      serverUrl.trim().isNotEmpty && token.trim().isNotEmpty;
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

  bool get hasUpdateDownloadProgress =>
      updateDownloading ||
      updateDownloadedBytes > 0 ||
      updateTotalBytes > 0 ||
      updateReadyToInstall;

  String get updateDownloadDetail {
    final parts = <String>[];
    if (updateTotalBytes > 0) {
      final percent = (updateDownloadProgress.clamp(0, 1) * 100).floor();
      parts.add(
        '$percent% · ${formatByteCount(updateDownloadedBytes)} / ${formatByteCount(updateTotalBytes)}',
      );
    } else if (updateDownloadedBytes > 0) {
      parts.add(formatByteCount(updateDownloadedBytes));
    }
    if (updateDownloadBytesPerSecond > 0) {
      parts.add('${formatByteCount(updateDownloadBytesPerSecond)}/s');
    }
    if (updateDownloadAccelerated && updateDownloadConnections > 1) {
      parts.add('分段 x$updateDownloadConnections');
    }
    return parts.join(' · ');
  }

  Future<void> initialize() async {
    await _loadAppVersion();
    serverUrl = await bridge.getString('serverUrl') ?? serverUrl;
    token = await bridge.getString('token') ?? '';
    cookie = await bridge.getString('cookie') ?? '';
    activeSessionId = await bridge.getString('activeSessionId') ?? '';
    theme = await bridge.getString('theme') ?? 'paper';
    updateDownloadConnectionLimit = normalizeUpdateDownloadConnectionLimit(
      int.tryParse(
        await bridge.getString('updateDownloadConnectionLimit') ?? '',
      ),
    );
    dismissedNoticeKeys = _decodeStringSet(
      await bridge.getString('dismissedNoticeKeys') ?? '',
    );
    deviceId = await bridge.getString('deviceId') ?? '';
    if (deviceId.isEmpty) {
      deviceId =
          'android-${DateTime.now().millisecondsSinceEpoch}-${Random().nextInt(999999)}';
      await bridge.setString('deviceId', deviceId);
    }
    if (_usesAndroidLoopbackServerUrl()) {
      cookie = '';
      await bridge.remove('cookie');
      errorMessage =
          'Android APP 不能使用 127.0.0.1 连接电脑服务，请改成电脑局域网 IP，例如 http://电脑IP:18637。';
      notifyListeners();
      return;
    }
    _configureApi();
    await refreshHealth();
    if (token.isNotEmpty && cookie.isNotEmpty) {
      await connectSocket();
      unawaited(loadCodexOptions());
      unawaited(loadWorkspace());
      unawaited(loadAuthSessions());
    }
    unawaited(checkForUpdate(silent: true));
  }

  Future<void> _loadAppVersion() async {
    try {
      final version = await bridge.getAppVersion();
      packageName = version.packageName;
      appVersionName = version.versionName;
      appVersionCode = version.versionCode;
    } catch (_) {
      // Unit tests and non-Android shells may not have the platform channel.
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

  void setUpdateDownloadConnectionLimit(int value) {
    updateDownloadConnectionLimit = normalizeUpdateDownloadConnectionLimit(
      value,
    );
    unawaited(
      bridge.setString(
        'updateDownloadConnectionLimit',
        updateDownloadConnectionLimit.toString(),
      ),
    );
    notifyListeners();
  }

  void clearError() {
    errorMessage = '';
    notifyListeners();
  }

  Future<bool> checkForUpdate({bool silent = false}) async {
    updateChecking = true;
    if (!silent) {
      updateMessage = '正在检查更新...';
    }
    notifyListeners();
    try {
      if (appVersionName.isEmpty) {
        await _loadAppVersion();
      }
      final info = await _fetchLatestRelease();
      final currentVersion = appVersionName.ifEmpty('0.0.0');
      if (compareVersionNames(info.versionName, currentVersion) > 0) {
        availableUpdate = info;
        updateMessage = '发现新版本 ${info.versionName}';
        return true;
      }
      availableUpdate = null;
      if (!silent) {
        updateMessage = '当前已经是最新版本';
      }
      return false;
    } catch (error) {
      if (!silent) {
        updateMessage = _friendlyErrorMessage(error);
      }
      return false;
    } finally {
      updateChecking = false;
      notifyListeners();
    }
  }

  Future<void> openReleasePage() async {
    final url = availableUpdate?.releaseUrl ?? githubReleasePageUrl;
    try {
      await bridge.openUrl(url);
    } catch (error) {
      updateMessage = _friendlyErrorMessage(error);
      notifyListeners();
    }
  }

  Future<void> downloadAvailableUpdate() async {
    var info = availableUpdate;
    if (info == null) {
      final hasUpdate = await checkForUpdate();
      if (!hasUpdate) {
        return;
      }
      info = availableUpdate;
    }
    if (info == null) {
      return;
    }
    updateDownloading = true;
    _resetUpdateDownloadProgress();
    updateMessage = '正在准备下载 ${info.versionName}...';
    notifyListeners();
    try {
      final downloaded = await bridge.downloadUpdateApk(
        url: info.apkUrl,
        fileName: info.apkName,
        maxConnections: updateDownloadConnectionLimit,
      );
      updateDownloadedApkName = downloaded.fileName.ifEmpty(info.apkName);
      updateReadyToInstall = updateDownloadedApkName.isNotEmpty;
      updateMessage = updateReadyToInstall ? '安装包已下载，点击安装更新' : '下载完成';
    } catch (error) {
      if (_isDownloadCancelledError(error)) {
        _resetUpdateDownloadProgress();
        updateMessage = '下载已取消';
      } else {
        updateMessage = _friendlyErrorMessage(error);
      }
    } finally {
      updateDownloading = false;
      notifyListeners();
    }
  }

  Future<void> installDownloadedUpdate() async {
    final fileName = updateDownloadedApkName.ifEmpty(
      availableUpdate?.apkName ?? '',
    );
    if (fileName.isEmpty) {
      updateMessage = '没有可安装的更新包';
      notifyListeners();
      return;
    }
    try {
      await bridge.installDownloadedApk(fileName: fileName);
      updateMessage = '安装器已打开，请按系统提示完成安装';
    } catch (error) {
      updateMessage = _friendlyErrorMessage(error);
    }
    notifyListeners();
  }

  Future<void> cancelUpdateDownload() async {
    if (!updateDownloading) {
      return;
    }
    updateMessage = '正在取消下载...';
    notifyListeners();
    try {
      await bridge.cancelUpdateDownload();
    } catch (error) {
      updateMessage = _friendlyErrorMessage(error);
      notifyListeners();
    }
  }

  void _handleDownloadProgress(UpdateDownloadProgress progress) {
    updateDownloadStage = progress.status;
    updateDownloadedBytes = progress.downloadedBytes;
    updateTotalBytes = progress.totalBytes;
    updateDownloadBytesPerSecond = progress.bytesPerSecond;
    updateDownloadProgress = progress.progress;
    updateDownloadAccelerated = progress.accelerated;
    updateDownloadConnections = progress.connections;

    if (progress.message.trim().isNotEmpty) {
      updateMessage = progress.message.trim();
    } else {
      updateMessage = switch (progress.status) {
        'preparing' => '正在准备下载...',
        'downloading' => '正在下载...',
        'completed' => '下载完成',
        'installing' => '正在打开安装器...',
        'cancelled' => '下载已取消',
        _ => '正在下载...',
      };
    }
    notifyListeners();
  }

  void _resetUpdateDownloadProgress() {
    updateDownloadProgress = 0;
    updateDownloadedBytes = 0;
    updateTotalBytes = 0;
    updateDownloadBytesPerSecond = 0;
    updateDownloadAccelerated = false;
    updateDownloadConnections = 1;
    updateDownloadStage = '';
    updateReadyToInstall = false;
    updateDownloadedApkName = '';
  }

  Future<MobileUpdateInfo> _fetchLatestRelease() async {
    late Object pageError;
    try {
      return await _fetchLatestReleaseFromHtml();
    } catch (error) {
      pageError = error;
    }
    try {
      return await _fetchLatestReleaseFromApi();
    } catch (error) {
      throw ApiException(
        _mergeUniqueMessages([
          _friendlyErrorMessage(pageError),
          _friendlyErrorMessage(error),
        ]),
      );
    }
  }

  Future<MobileUpdateInfo> _fetchLatestReleaseFromApi() async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 12);
    try {
      final request = await client
          .getUrl(Uri.parse(githubReleaseApiUrl))
          .timeout(const Duration(seconds: 12));
      request.headers.set(
        HttpHeaders.acceptHeader,
        'application/vnd.github+json',
      );
      request.headers.set(HttpHeaders.userAgentHeader, 'CodexRemoteMobile');
      final response = await request.close().timeout(
        const Duration(seconds: 12),
      );
      final text = await response
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 12));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(githubUpdateHttpErrorMessage(response.statusCode));
      }
      final decoded = jsonDecode(text);
      if (decoded is! JsonMap) {
        throw ApiException('GitHub 发布信息格式不正确');
      }
      final assets = decoded['assets'];
      if (assets is! List) {
        throw ApiException('GitHub 发布页没有 APK 文件');
      }
      final apkAssets = assets
          .whereType<JsonMap>()
          .where((asset) => readString(asset, 'name').endsWith('.apk'))
          .toList(growable: false);
      final selectedAssetName = selectBestMobileApkAssetName(
        apkAssets.map((asset) => readString(asset, 'name')),
      );
      final selectedAsset = selectedAssetName.isEmpty
          ? null
          : apkAssets.firstWhere(
              (asset) => readString(asset, 'name') == selectedAssetName,
            );
      if (selectedAsset == null) {
        throw ApiException('GitHub 发布页没有可下载的 APK');
      }
      final apkName = readString(selectedAsset, 'name');
      final apkUrl = readString(selectedAsset, 'browser_download_url');
      if (apkUrl.isEmpty) {
        throw ApiException('GitHub 发布页缺少 APK 下载地址');
      }
      final tagName = readString(decoded, 'tag_name');
      final versionName = extractVersionNameFromRelease(
        assetName: apkName,
        tagName: tagName,
        releaseName: readString(decoded, 'name'),
      );
      if (versionName.isEmpty) {
        throw ApiException('无法识别 GitHub 发布版本号');
      }
      return MobileUpdateInfo(
        versionName: versionName,
        tagName: tagName,
        releaseUrl: readString(
          decoded,
          'html_url',
        ).ifEmpty(githubReleasePageUrl),
        apkName: apkName,
        apkUrl: apkUrl,
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<MobileUpdateInfo> _fetchLatestReleaseFromHtml() async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 12);
    try {
      final request = await client
          .getUrl(Uri.parse(githubLatestReleasePageUrl))
          .timeout(const Duration(seconds: 12));
      request.headers.set(HttpHeaders.acceptHeader, 'text/html');
      request.headers.set(HttpHeaders.userAgentHeader, 'CodexRemoteMobile');
      final response = await request.close().timeout(
        const Duration(seconds: 12),
      );
      final text = await response
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 12));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(githubUpdateHttpErrorMessage(response.statusCode));
      }
      final finalUrl = response.redirects.isNotEmpty
          ? response.redirects.last.location.toString()
          : githubLatestReleasePageUrl;
      final info = extractMobileUpdateInfoFromReleaseHtml(
        html: text,
        finalUrl: finalUrl,
      );
      if (info != null) {
        return info;
      }
      final expandedAssetsUrl = extractGithubExpandedAssetsUrl(
        html: text,
        finalUrl: finalUrl,
      );
      if (expandedAssetsUrl.isNotEmpty) {
        final expandedRequest = await client
            .getUrl(Uri.parse(expandedAssetsUrl))
            .timeout(const Duration(seconds: 12));
        expandedRequest.headers.set(HttpHeaders.acceptHeader, 'text/html');
        expandedRequest.headers.set(
          HttpHeaders.userAgentHeader,
          'CodexRemoteMobile',
        );
        final expandedResponse = await expandedRequest.close().timeout(
          const Duration(seconds: 12),
        );
        final expandedText = await expandedResponse
            .transform(utf8.decoder)
            .join()
            .timeout(const Duration(seconds: 12));
        if (expandedResponse.statusCode < 200 ||
            expandedResponse.statusCode >= 300) {
          throw ApiException(
            githubUpdateHttpErrorMessage(expandedResponse.statusCode),
          );
        }
        final expandedInfo = extractMobileUpdateInfoFromReleaseHtml(
          html: expandedText,
          finalUrl: finalUrl,
        );
        if (expandedInfo != null) {
          return expandedInfo;
        }
      }
      throw ApiException('GitHub 发布页没有可下载的 APK');
    } finally {
      client.close(force: true);
    }
  }

  Future<bool> login() async {
    busy = true;
    errorMessage = '';
    notifyListeners();
    try {
      _validateLoginConfig();
      _configureApi();
      await api.postJson('/api/auth/session', {
        'token': token.trim(),
        'deviceName': 'Android App',
        'deviceId': deviceId,
      }, token: token.trim());
      cookie = api.cookie;
      if (cookie.isEmpty) {
        throw ApiException('服务没有返回登录 Cookie');
      }
      await bridge.setString('serverUrl', serverUrl.trim());
      await bridge.setString('token', token.trim());
      await bridge.setString('cookie', cookie);
      await connectSocket();
      await refreshHealth();
      await loadCodexOptions();
      await loadWorkspace();
      await loadAuthSessions();
      return true;
    } catch (error) {
      errorMessage = _friendlyErrorMessage(error);
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void _validateLoginConfig() {
    serverUrl = serverUrl.trim();
    token = token.trim();
    if (serverUrl.isEmpty) {
      throw ApiException('请填写服务地址，例如 http://电脑IP:18637。');
    }
    if (token.isEmpty) {
      throw ApiException('请填写访问 Token。');
    }
    if (_usesAndroidLoopbackServerUrl()) {
      throw ApiException(
        'Android APP 不能使用 127.0.0.1 连接电脑服务，请改成电脑局域网 IP，例如 http://电脑IP:18637。',
      );
    }
  }

  String _friendlyErrorMessage(Object error) {
    if (error is ApiException) {
      return error.message;
    }
    if (error is TimeoutException) {
      return '连接超时，请确认电脑服务正在运行，并且手机能访问这个地址。';
    }
    if (error is PlatformException) {
      if (error.code == 'download_cancelled') {
        return '下载已取消';
      }
      final message = error.message?.trim() ?? '';
      return message.isEmpty ? '操作失败：${error.code}' : message;
    }
    if (error is SocketException) {
      final message = error.message.toLowerCase();
      if (message.contains('failed host lookup')) {
        return '找不到服务地址，请检查 IP 或域名是否正确。';
      }
      if (message.contains('connection refused') ||
          message.contains('actively refused') ||
          message.contains('connection failed')) {
        return '服务拒绝连接，请确认 Windows 端服务已启动并监听 18637 端口。';
      }
      if (message.contains('network is unreachable') ||
          message.contains('no route to host')) {
        return '手机无法访问该网络地址，请确认手机和电脑在同一网络或使用 Tailscale 地址。';
      }
      return '连接失败：${error.message}';
    }
    if (error is FormatException) {
      return '服务地址格式不正确，请填写类似 http://电脑IP:18637 的地址。';
    }
    final text = error.toString();
    return text.isEmpty ? '连接失败，请检查服务地址和 Token。' : text;
  }

  bool _isDownloadCancelledError(Object error) {
    return error is PlatformException && error.code == 'download_cancelled';
  }

  bool _usesAndroidLoopbackServerUrl() {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return false;
    }
    final trimmed = serverUrl.trim();
    if (trimmed.isEmpty) {
      return false;
    }
    final withScheme =
        trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('ws://') ||
            trimmed.startsWith('wss://')
        ? trimmed
        : 'http://$trimmed';
    final uri = Uri.tryParse(withScheme);
    final host = uri?.host.toLowerCase() ?? '';
    return host == '127.0.0.1' || host == 'localhost' || host == '::1';
  }

  Future<void> logout() async {
    await _socket?.close();
    await _stopBackgroundKeepAlive();
    cookie = '';
    sessions = [];
    authSessions = [];
    activeSessionId = '';
    approvals = [];
    timelineByThread.clear();
    attachmentsByThread.clear();
    unreadThreadIds.clear();
    await bridge.remove('cookie');
    await bridge.remove('activeSessionId');
    notifyListeners();
  }

  Future<void> loadAuthSessions() async {
    if (cookie.isEmpty) {
      authSessions = [];
      notifyListeners();
      return;
    }
    authSessionsLoading = true;
    notifyListeners();
    try {
      final payload = await api.getJson('/api/auth/sessions');
      final rawSessions = payload['sessions'];
      authSessions = rawSessions is List
          ? rawSessions
                .whereType<JsonMap>()
                .map(AuthSessionItem.fromJson)
                .toList(growable: false)
          : [];
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      authSessionsLoading = false;
      notifyListeners();
    }
  }

  Future<void> revokeAuthSessions() async {
    if (cookie.isEmpty) {
      return;
    }
    busy = true;
    notifyListeners();
    try {
      await api.deleteJson('/api/auth/sessions');
      await logout();
      token = '';
      await bridge.remove('token');
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> refreshHealth() async {
    healthStatus = 'loading';
    errorMessage = '';
    notifyListeners();
    try {
      if (serverUrl.trim().isEmpty) {
        throw ApiException('请填写服务地址，例如 http://电脑IP:18637。');
      }
      if (_usesAndroidLoopbackServerUrl()) {
        throw ApiException(
          'Android APP 不能使用 127.0.0.1 连接电脑服务，请改成电脑局域网 IP，例如 http://电脑IP:18637。',
        );
      }
      _configureApi();
      final payload = await api.getJson('/health');
      healthStatus = readString(payload, 'status', 'ok');
      notifyListeners();
      return true;
    } catch (error) {
      healthStatus = 'error';
      errorMessage = _friendlyErrorMessage(error);
      notifyListeners();
      return false;
    }
  }

  Future<void> loadCodexOptions() async {
    try {
      final payload = await api.getJson(
        '/api/codex/options',
        query: workspacePath.isEmpty ? const {} : {'cwd': workspacePath},
      );
      final models = payload['models'];
      modelOptions = models is List
          ? models.whereType<JsonMap>().map(CodexModelOption.fromJson).toList()
          : [];
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
      final selected =
          path ?? workspacePath.ifEmpty(readString(shortcuts, 'preferredPath'));
      workspacePath = selected;
      final listing = await api.getJson(
        '/api/workspace/list',
        query: selected.isEmpty ? const {} : {'path': selected},
      );
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
      if (status == 'connected') {
        unawaited(_startBackgroundKeepAlive());
      } else if (status == 'idle') {
        unawaited(_stopBackgroundKeepAlive());
      }
      notifyListeners();
    });
    await socket.connect();
    _syncActiveThread();
  }

  Future<void> _startBackgroundKeepAlive() async {
    if (backgroundKeepAliveActive || cookie.isEmpty) {
      return;
    }
    try {
      unawaited(bridge.requestNotificationPermission());
      await bridge.startBackgroundKeepAlive(
        title: 'Codex Remote 已连接',
        body: '后台保持与 Windows 服务通信',
      );
      backgroundKeepAliveActive = true;
      notifyListeners();
    } catch (error) {
      errorMessage = _friendlyErrorMessage(error);
      notifyListeners();
    }
  }

  Future<void> _stopBackgroundKeepAlive({bool notify = true}) async {
    if (!backgroundKeepAliveActive) {
      return;
    }
    try {
      await bridge.stopBackgroundKeepAlive();
    } catch (_) {
      // The app may be shutting down or running in a non-Android test shell.
    }
    backgroundKeepAliveActive = false;
    if (notify) {
      notifyListeners();
    }
  }

  void selectSession(String threadId) {
    activeSessionId = threadId;
    unreadThreadIds.remove(threadId);
    unawaited(bridge.setString('activeSessionId', threadId));
    _syncActiveThread();
    notifyListeners();
  }

  void _syncActiveThread() {
    if (activeSessionId.isEmpty) {
      return;
    }
    _socket?.send({'type': 'thread_sync', 'threadId': activeSessionId});
  }

  Future<void> createSession({
    required String name,
    required String cwd,
  }) async {
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
      updatePrefs(
        current.copyWith(
          approvalPolicy: 'on-request',
          sandboxMode: 'read-only',
        ),
      );
    } else if (preset == 'full-access') {
      updatePrefs(
        current.copyWith(
          approvalPolicy: 'never',
          sandboxMode: 'danger-full-access',
        ),
      );
    } else {
      updatePrefs(
        current.copyWith(
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
        ),
      );
    }
  }

  Future<void> sendPrompt(String text) async {
    final trimmed = text.trim();
    final pendingAttachments = activeAttachments;
    if ((trimmed.isEmpty && pendingAttachments.isEmpty) ||
        activeSessionId.isEmpty) {
      return;
    }
    final now = DateTime.now().millisecondsSinceEpoch;
    final clientMessageId = 'mobile-$now';
    _appendEntry(
      activeSessionId,
      TimelineEntry(
        id: 'local-user:$clientMessageId',
        type: 'message',
        title: '你',
        role: 'user',
        text: trimmed.isEmpty ? '图片' : trimmed,
        attachments: pendingAttachments,
        turnId: '$activeSessionId:pending-turn',
        itemId: clientMessageId,
        createdAt: now,
      ),
    );
    if (trimmed.startsWith('/') || trimmed.startsWith('!')) {
      _socket?.send({
        'type': 'command_send',
        'threadId': activeSessionId,
        'text': trimmed,
        'clientMessageId': clientMessageId,
      });
      notifyListeners();
      return;
    }
    final prefs = activePrefs;
    final attachments = pendingAttachments
        .map((item) => {'path': item.filePath, 'name': item.name})
        .toList(growable: false);
    attachmentsByThread[activeSessionId] = [];
    _socket?.send({
      'type': 'turn_send',
      'threadId': activeSessionId,
      'text': trimmed,
      'attachments': attachments,
      'clientMessageId': clientMessageId,
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
    attachmentsByThread[activeSessionId] = activeAttachments
        .where((item) => item.id != id)
        .toList(growable: false);
    notifyListeners();
  }

  void respondApproval(ServerRequestItem request, dynamic response) {
    _socket?.send({
      'type': 'server_request_respond',
      'requestId': request.requestId,
      'response': response,
    });
    approvals = approvals
        .map((item) {
          if (item.requestId == request.requestId) {
            final next = JsonMap.from(item.raw);
            next['status'] = 'submitting';
            return ServerRequestItem(next);
          }
          return item;
        })
        .toList(growable: false);
    notifyListeners();
  }

  void dismissNotice(int index) {
    if (index < 0 || index >= notices.length) {
      return;
    }
    final notice = notices.removeAt(index);
    final dismissKey = readString(notice, 'dismissKey');
    if (dismissKey.isNotEmpty) {
      dismissedNoticeKeys = {...dismissedNoticeKeys, dismissKey};
      unawaited(_persistDismissedNoticeKeys());
    }
    notifyListeners();
  }

  void toggleControls() {
    controlsExpanded = !controlsExpanded;
    notifyListeners();
  }

  void setAppForeground(bool value) {
    appInForeground = value;
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
          selectSession(
            readString(message, 'threadId', readString(tab, 'threadId')),
          );
        }
        break;
      case 'tab_updated':
        final tab = message['tab'];
        if (tab is JsonMap) {
          _upsertSession(SessionItem.fromJson(tab));
        }
        break;
      case 'tab_removed':
        _removeSession(readString(message, 'threadId'));
        break;
      case 'unread':
        final threadId = readString(message, 'threadId');
        if (threadId.isNotEmpty && threadId != activeSessionId) {
          unreadThreadIds = {...unreadThreadIds, threadId};
        }
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
        approvals = approvals
            .where((item) => item.requestId != readString(message, 'requestId'))
            .toList(growable: false);
        break;
      case 'server_request_reset':
        approvals = [];
        break;
      case 'turn_started':
        _setTurnStarted(
          readString(message, 'threadId'),
          readString(message, 'turnId'),
          readInt(message, 'startedAt'),
        );
        break;
      case 'turn_completed':
        _setTurnCompleted(
          readString(message, 'threadId'),
          readString(message, 'turnId'),
        );
        break;
      case 'agent_delta':
        _appendAgentDelta(message);
        break;
      case 'plan_delta':
        _appendPlanDelta(message);
        break;
      case 'turn_plan_updated':
        _appendPlan(message);
        break;
      case 'item_started':
        _appendItemStarted(message);
        break;
      case 'item_completed':
        _appendItemCompleted(message);
        break;
      case 'item_delta':
        _appendItemDelta(message);
        break;
      case 'thread_event':
        if (_shouldDisplayThreadEvent(readString(message, 'method'))) {
          _appendThreadEvent(message);
        }
        break;
      case 'hook_started':
      case 'hook_completed':
        _appendHookEvent(message);
        break;
      case 'guardian_review_started':
      case 'guardian_review_completed':
        _appendGuardianEvent(message);
        break;
      case 'mcp_tool_progress':
        _appendMcpProgress(message);
        break;
      case 'turn_diff_updated':
        _appendTurnDiff(message);
        break;
      case 'model_rerouted':
        _applyModelReroute(message);
        break;
      case 'token_usage':
        final threadId = readString(message, 'threadId');
        final usage = message['usage'];
        if (threadId.isNotEmpty && usage is JsonMap) {
          tokenUsageByThread[threadId] = usage;
        }
        break;
      case 'codex_error':
        _appendNoticeEvent(
          readString(message, 'threadId'),
          'Codex 错误',
          _extractText(message['error']).ifEmpty('发生了 Codex 错误'),
          'error',
        );
        break;
      case 'warning':
      case 'error_notice':
        _pushNotice({
          'level':
              type == 'error' ||
                  type == 'error_notice' ||
                  type == 'backend_error'
              ? 'error'
              : 'warning',
          'title': readString(
            message,
            'noticeKind',
            type == 'warning' ? '警告' : '错误',
          ),
          'message': readString(message, 'message', jsonEncode(message)),
          'threadId': readString(message, 'threadId'),
          'dismissKey': _dismissKeyForMessage(message),
        });
        break;
      case 'backend_error':
        _appendNoticeEvent(
          activeSessionId,
          '后端错误',
          readString(message, 'message', jsonEncode(message)),
          'error',
        );
        break;
      case 'error':
        _handleErrorMessage(message);
        break;
      case 'notification':
        _handleNotification(message);
        break;
    }
    notifyListeners();
  }

  void _configureApi() {
    _api?.close();
    serverUrl = serverUrl.trim();
    _api = CodexApi(baseUrl: serverUrl, cookie: cookie);
  }

  void _replaceSessions(dynamic value) {
    if (value is! List) {
      sessions = [];
      return;
    }
    sessions = value
        .whereType<JsonMap>()
        .map(SessionItem.fromJson)
        .where((item) => item.threadId.isNotEmpty)
        .toList(growable: false);
    if (sessions.isEmpty) {
      activeSessionId = '';
      unawaited(bridge.remove('activeSessionId'));
      return;
    }
    if (activeSessionId.isEmpty ||
        !sessions.any((item) => item.threadId == activeSessionId)) {
      activeSessionId = sessions.first.threadId;
      unawaited(bridge.setString('activeSessionId', activeSessionId));
    }
    for (final session in sessions) {
      prefsByThread.putIfAbsent(
        session.threadId,
        () => _prefsFromSession(session) ?? defaultPrefs,
      );
      if (session.tokenUsage != null) {
        tokenUsageByThread[session.threadId] = session.tokenUsage!;
      }
    }
    _syncActiveThread();
  }

  void _replaceApprovals(dynamic value) {
    approvals = value is List
        ? value
              .whereType<JsonMap>()
              .map(ServerRequestItem.new)
              .toList(growable: false)
        : [];
  }

  void _replaceGlobalNotices(dynamic value) {
    if (value is! List) {
      return;
    }
    for (final item in value.whereType<JsonMap>()) {
      final id = readString(item, 'id');
      final text = readString(item, 'text');
      if (id.isEmpty || text.trim().isEmpty) {
        continue;
      }
      final kind = readString(item, 'noticeKind', 'info');
      _pushNotice({
        'level': kind == 'error'
            ? 'error'
            : kind == 'warning'
            ? 'warning'
            : 'info',
        'title': kind.isEmpty ? '通知' : kind,
        'message': text,
        'threadId': readString(item, 'threadId'),
        'dismissKey':
            'global-notice:$id:${readString(item, 'threadId')}:$kind:$text',
      });
    }
  }

  void _removeSession(String threadId) {
    if (threadId.isEmpty) {
      return;
    }
    sessions = sessions
        .where((item) => item.threadId != threadId)
        .toList(growable: false);
    timelineByThread.remove(threadId);
    attachmentsByThread.remove(threadId);
    tokenUsageByThread.remove(threadId);
    activeTurnStartedAt.remove(threadId);
    prefsByThread.remove(threadId);
    unreadThreadIds.remove(threadId);
    approvals = approvals
        .where((item) => item.threadId != threadId)
        .toList(growable: false);
    if (activeSessionId == threadId) {
      activeSessionId = sessions.isEmpty ? '' : sessions.first.threadId;
      unawaited(bridge.setString('activeSessionId', activeSessionId));
    }
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
    prefsByThread.putIfAbsent(
      session.threadId,
      () => _prefsFromSession(session) ?? defaultPrefs,
    );
    if (session.tokenUsage != null) {
      tokenUsageByThread[session.threadId] = session.tokenUsage!;
    }
  }

  void _upsertApproval(ServerRequestItem request) {
    if (request.requestId.isEmpty) {
      return;
    }
    final next = [...approvals];
    final index = next.indexWhere(
      (item) => item.requestId == request.requestId,
    );
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
    _ensureThreadVisible(threadId);
    var entries = <TimelineEntry>[
      ...(timelineByThread[threadId] ?? const <TimelineEntry>[]),
    ];
    final turns = message['turns'];
    if (turns is List) {
      for (var index = 0; index < turns.length; index += 1) {
        final rawTurn = _asJsonMap(turns[index]);
        if (rawTurn != null) {
          entries.addAll(_entriesFromTurn(threadId, rawTurn, index));
        }
      }
    }
    final turnPlans = message['turnPlans'];
    if (turnPlans is List) {
      for (final rawPlan in turnPlans) {
        final plan = _asJsonMap(rawPlan);
        if (plan == null) {
          continue;
        }
        final entry = _entryFromTurnPlan(plan);
        if (entry != null) {
          entries.add(entry);
        }
      }
    }
    final turnDiffs = message['turnDiffs'];
    if (turnDiffs is List) {
      for (final rawDiff in turnDiffs) {
        final diff = _asJsonMap(rawDiff);
        if (diff == null) {
          continue;
        }
        final entry = _entryFromTurnDiff(diff);
        if (entry != null) {
          entries = _mergeTurnDiffEntry(entries, entry);
        }
      }
    }
    final supplemental = message['supplementalItems'];
    if (supplemental is List) {
      for (final rawItem in supplemental) {
        final item = _asJsonMap(rawItem);
        if (item == null) {
          continue;
        }
        final entry = _entryFromSupplemental(item);
        if (entry != null) {
          entries.add(entry);
        }
      }
    }
    _replaceGlobalNotices(message['globalSupplementalItems']);
    final events = message['timelineEvents'];
    final replayedEvents = <JsonMap>[];
    if (events is List) {
      final completedAssistantTextItemIds = events
          .map(_asJsonMap)
          .whereType<JsonMap>()
          .where((event) => readString(event, 'type') == 'item_completed')
          .map((event) {
            final item = _asJsonMap(event['item']);
            if (item == null ||
                !_isAssistantMessageItem(
                  readString(item, 'type'),
                  readString(item, 'role'),
                )) {
              return '';
            }
            if (_messageItemText(item).trim().isEmpty) {
              return '';
            }
            return readString(event, 'itemId').ifEmpty(readString(item, 'id'));
          })
          .where((itemId) => itemId.isNotEmpty)
          .toSet();
      final settledIds = entries
          .where((entry) => !entry.partial && entry.status != 'running')
          .expand((entry) => [entry.id, entry.itemId])
          .where((value) => value.isNotEmpty)
          .toSet();
      for (final rawEvent in events) {
        final rawMap = _asJsonMap(rawEvent);
        if (rawMap == null) {
          continue;
        }
        final event = readString(rawMap, 'threadId').isEmpty
            ? {...rawMap, 'threadId': threadId}
            : rawMap;
        final item = _asJsonMap(event['item']);
        final itemId = readString(
          event,
          'itemId',
        ).ifEmpty(item == null ? '' : readString(item, 'id'));
        if (readString(event, 'type') == 'agent_delta' &&
            completedAssistantTextItemIds.contains(itemId)) {
          continue;
        }
        if (!_shouldReplayThreadSyncEvent(
          threadId,
          event,
          entries,
          settledIds,
        )) {
          continue;
        }
        replayedEvents.add(event);
      }
    }
    entries = _dropReplayRebuiltEntries(entries, replayedEvents);
    entries.sort(_compareTimelineEntries);
    timelineByThread[threadId] = _dedupeEntries(entries);
    final usage = message['tokenUsage'];
    if (usage is JsonMap) {
      tokenUsageByThread[threadId] = usage;
    }
    _restoreActiveTurn(threadId, turns);
    for (final event in replayedEvents) {
      _applyThreadSyncEvent(event);
    }
    unreadThreadIds.remove(threadId);
  }

  List<TimelineEntry> _dropReplayRebuiltEntries(
    List<TimelineEntry> entries,
    List<JsonMap> replayedEvents,
  ) {
    final assistantItemIds = replayedEvents
        .where((event) => readString(event, 'type') == 'agent_delta')
        .map((event) {
          final itemId = readString(event, 'itemId');
          if (itemId.isNotEmpty) {
            return itemId;
          }
          final threadId = readString(event, 'threadId');
          final turnId = readString(event, 'turnId');
          return threadId.isNotEmpty && turnId.isNotEmpty
              ? '$threadId:$turnId:assistant'
              : '';
        })
        .where((itemId) => itemId.isNotEmpty)
        .toSet();
    if (assistantItemIds.isEmpty) {
      return entries;
    }
    return entries
        .where((entry) {
          if (entry.type != 'message' || entry.role != 'assistant') {
            return true;
          }
          if (!entry.partial && entry.status != 'running') {
            return true;
          }
          return !assistantItemIds.contains(entry.itemId) &&
              !assistantItemIds.contains(entry.id);
        })
        .toList(growable: false);
  }

  void _ensureThreadVisible(String threadId) {
    if (!sessions.any((item) => item.threadId == threadId)) {
      sessions = [...sessions, SessionItem(threadId: threadId, name: '未命名会话')];
    }
    if (activeSessionId.isEmpty ||
        !sessions.any((item) => item.threadId == activeSessionId)) {
      activeSessionId = threadId;
      unawaited(bridge.setString('activeSessionId', activeSessionId));
    }
  }

  List<TimelineEntry> _entriesFromTurn(
    String threadId,
    JsonMap turn,
    int index,
  ) {
    final threadEntries = <TimelineEntry>[];
    final turnId = readString(turn, 'id', '$threadId-$index');
    final syntheticTurnTime = 1700000000000 + ((index + 1) * 1000);
    final createdAt = _normalizeTimestamp(
      readInt(
        turn,
        'createdAt',
        readInt(
          turn,
          'updatedAt',
          readInt(turn, 'startedAt', syntheticTurnTime),
        ),
      ),
    );
    var hasUserMessage = false;
    var hasAssistantMessage = false;
    final items = turn['items'];
    var itemCount = 0;
    if (items is List) {
      itemCount = items.length;
      for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        final item = _asJsonMap(items[itemIndex]);
        if (item == null) {
          continue;
        }
        final entry = _entryFromItem(item, turnId, createdAt + itemIndex);
        if (entry == null) {
          continue;
        }
        threadEntries.add(entry);
        if (entry.type == 'message' && entry.role == 'user') {
          hasUserMessage = true;
        } else if (entry.type == 'message' && entry.role == 'assistant') {
          hasAssistantMessage = true;
        }
      }
    }
    final inputText = _extractTurnUserText(turn);
    final inputAttachments = _attachmentsFromInput(turn['input']);
    if (!hasUserMessage && inputText.isNotEmpty) {
      threadEntries.add(
        TimelineEntry(
          id: 'turn-$turnId-user',
          type: 'message',
          title: '你',
          role: 'user',
          text: inputText,
          attachments: inputAttachments,
          turnId: turnId,
          createdAt: createdAt,
        ),
      );
    } else if (!hasUserMessage && inputAttachments.isNotEmpty) {
      threadEntries.add(
        TimelineEntry(
          id: 'turn-$turnId-user',
          type: 'message',
          title: '你',
          role: 'user',
          text: '图片',
          attachments: inputAttachments,
          turnId: turnId,
          createdAt: createdAt,
        ),
      );
    }
    final outputText = _extractTurnAssistantText(turn);
    if (outputText.isNotEmpty && !hasAssistantMessage) {
      threadEntries.add(
        TimelineEntry(
          id: 'turn-$turnId-assistant',
          type: 'message',
          title: 'Codex',
          role: 'assistant',
          text: outputText,
          turnId: turnId,
          createdAt: _normalizeTimestamp(
            readInt(
              turn,
              'completedAt',
              readInt(turn, 'updatedAt', createdAt + itemCount),
            ),
          ),
        ),
      );
    }
    return threadEntries;
  }

  String _extractTurnUserText(JsonMap turn) {
    final direct = readString(turn, 'text');
    if (direct.trim().isNotEmpty) {
      return direct.trim();
    }
    final items = turn['items'];
    if (items is List) {
      final parts = <String>[];
      for (final rawItem in items) {
        final item = _asJsonMap(rawItem);
        if (item == null) {
          continue;
        }
        final type = readString(item, 'type');
        final role = readString(item, 'role');
        if (_isUserMessageItem(type, role)) {
          parts.add(
            _extractText(item['text'])
                .ifEmpty(_extractText(item['content']))
                .ifEmpty(_extractText(item['input']))
                .ifEmpty(_extractText(item['message']))
                .ifEmpty(_extractText(item['parts'])),
          );
        }
      }
      final joined = parts.where((item) => item.trim().isNotEmpty).join('\n');
      if (joined.isNotEmpty) {
        return joined;
      }
    }
    final inputText = _extractText(turn['input']);
    if (inputText.isNotEmpty) {
      return inputText;
    }
    return readString(turn, 'summary');
  }

  String _extractTurnAssistantText(JsonMap turn) {
    final outputText = _extractText(turn['output']);
    if (outputText.isNotEmpty) {
      return outputText;
    }
    final items = turn['items'];
    if (items is List) {
      for (final rawItem in items) {
        final item = _asJsonMap(rawItem);
        if (item == null) {
          continue;
        }
        final type = readString(item, 'type');
        final role = readString(item, 'role');
        if (_isAssistantMessageItem(type, role)) {
          final text = _extractText(item['text'])
              .ifEmpty(_extractText(item['content']))
              .ifEmpty(_extractText(item['output']))
              .ifEmpty(_extractText(item['message']))
              .ifEmpty(_extractText(item['parts']));
          if (text.isNotEmpty) {
            return text;
          }
        }
      }
    }
    return '';
  }

  List<AttachmentItem> _attachmentsFromInput(dynamic value) {
    if (value == null) {
      return const [];
    }
    if (value is List) {
      return _dedupeAttachments(
        value.expand(_attachmentsFromInput).toList(growable: false),
      );
    }
    if (value is! JsonMap) {
      return const [];
    }
    final type = readString(value, 'type');
    final path = readString(value, 'path')
        .ifEmpty(readString(value, 'filePath'))
        .ifEmpty(readString(value, 'file_path'))
        .ifEmpty(readString(value, 'image_url'))
        .ifEmpty(readString(value, 'imageUrl'))
        .ifEmpty(readString(value, 'url'));
    final url = readString(value, 'url')
        .ifEmpty(readString(value, 'image_url'))
        .ifEmpty(readString(value, 'imageUrl'))
        .ifEmpty(
          type == 'localImage' && path.isNotEmpty
              ? '/api/uploads/${Uri.encodeComponent(_basename(path))}'
              : '',
        );
    final nested = [
      ..._attachmentsFromInput(value['content']),
      ..._attachmentsFromInput(value['parts']),
      ..._attachmentsFromInput(value['input']),
      ..._attachmentsFromInput(value['message']),
      ..._attachmentsFromInput(value['output']),
      ..._attachmentsFromInput(value['attachments']),
    ];
    if (type == 'localImage' ||
        type == 'image' ||
        type == 'input_image' ||
        (path.isNotEmpty && _looksLikeImagePath(path))) {
      return _dedupeAttachments([
        AttachmentItem(
          id: path.isEmpty
              ? 'image-${DateTime.now().microsecondsSinceEpoch}'
              : path,
          name: _basename(path).ifEmpty('image'),
          contentType: readString(
            value,
            'contentType',
            readString(
              value,
              'mimeType',
              readString(value, 'mime_type', 'image/*'),
            ),
          ),
          filePath: path,
          url: url,
        ),
        ...nested,
      ]);
    }
    return nested;
  }

  List<AttachmentItem> _dedupeAttachments(List<AttachmentItem> items) {
    final byId = <String, AttachmentItem>{};
    for (final item in items) {
      final key = item.id
          .ifEmpty(item.filePath)
          .ifEmpty(item.url)
          .ifEmpty(item.name);
      if (key.isNotEmpty) {
        byId[key] = item;
      }
    }
    return byId.values.toList(growable: false);
  }

  bool _looksLikeImagePath(String path) {
    final lower = path.toLowerCase();
    return lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.bmp');
  }

  String _basename(String path) {
    final normalized = path.trim().replaceAll(RegExp(r'[\\/]+$'), '');
    if (normalized.isEmpty) {
      return '';
    }
    final parts = normalized
        .split(RegExp(r'[\\/]'))
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
    return parts.isEmpty ? normalized : parts.last;
  }

  TimelineEntry? _entryFromItem(JsonMap item, String turnId, int fallbackTime) {
    final type = readString(item, 'type');
    final id = readString(
      item,
      'id',
      'item-$turnId-${type.ifEmpty('item')}-$fallbackTime',
    );
    final status = readString(item, 'status', 'completed');
    final title = _itemTitle(type, item);
    final timelineType = _timelineTypeForItem(type);
    final role = _roleForItem(type, item);
    final attachments = _dedupeAttachments([
      ..._attachmentsFromInput(item['content']),
      ..._attachmentsFromInput(item['input']),
      ..._attachmentsFromInput(item['parts']),
      ..._attachmentsFromInput(item['message']),
      ..._attachmentsFromInput(item['attachments']),
    ]);
    if (timelineType == 'message' && (role == 'user' || role == 'assistant')) {
      final text = _messageItemText(item);
      if (text.isEmpty && attachments.isEmpty) {
        return null;
      }
      return TimelineEntry(
        id: id,
        type: 'message',
        title: role == 'user' ? '你' : 'Codex',
        role: role,
        text: text.ifEmpty(role == 'user' ? '图片' : ''),
        status: status,
        turnId: turnId,
        itemId: id,
        attachments: attachments,
        createdAt: _normalizeTimestamp(
          readInt(item, 'startedAt', readInt(item, 'createdAt', fallbackTime)),
        ),
        details: item,
        raw: item,
      );
    }
    final text = _itemText(item);
    final patchSource = readString(item, 'patch')
        .ifEmpty(readString(item, 'diff'))
        .ifEmpty(readString(item, 'output'))
        .ifEmpty(_extractText(item['output']))
        .ifEmpty(readString(item, 'aggregatedOutput'));
    final patch = timelineType == 'command' ? '' : patchSource;
    return TimelineEntry(
      id: id,
      type: timelineType,
      title: title,
      role: role,
      text: text,
      status: status,
      turnId: turnId,
      itemId: id,
      meta: _itemMeta(type, item),
      patch: patch,
      changes: readMapList(item, 'changes'),
      attachments: attachments,
      createdAt: _normalizeTimestamp(
        readInt(item, 'startedAt', readInt(item, 'createdAt', fallbackTime)),
      ),
      details: item,
      raw: item,
    );
  }

  bool _shouldReplayThreadSyncEvent(
    String threadId,
    JsonMap event,
    List<TimelineEntry> entries,
    Set<String> settledIds,
  ) {
    final eventType = readString(event, 'type');
    final eventThreadId = readString(event, 'threadId', threadId);
    if (eventType.isEmpty || eventThreadId != threadId) {
      return false;
    }
    if (eventType == 'thread_event' &&
        !_shouldDisplayThreadEvent(readString(event, 'method'))) {
      return false;
    }
    const replayable = {
      'agent_delta',
      'plan_delta',
      'turn_started',
      'turn_completed',
      'turn_plan_updated',
      'turn_diff_updated',
      'mcp_tool_progress',
      'item_started',
      'item_delta',
      'item_completed',
      'thread_event',
      'token_usage',
      'model_rerouted',
      'warning',
      'error_notice',
    };
    if (!replayable.contains(eventType)) {
      return false;
    }

    final item = _asJsonMap(event['item']) ?? const <String, dynamic>{};
    final itemId = readString(event, 'itemId').ifEmpty(readString(item, 'id'));
    if (itemId.isNotEmpty && settledIds.contains(itemId)) {
      return false;
    }
    final turnId = readString(event, 'turnId');
    final isAssistantEvent =
        eventType == 'agent_delta' ||
        (eventType == 'item_completed' &&
            _isAssistantMessageItem(
              readString(item, 'type'),
              readString(item, 'role'),
            ));
    if (isAssistantEvent && itemId.isEmpty && turnId.isNotEmpty) {
      final hasSettledAssistant = entries.any(
        (entry) =>
            entry.turnId == turnId &&
            entry.role == 'assistant' &&
            !entry.partial &&
            entry.status != 'running',
      );
      if (hasSettledAssistant) {
        return false;
      }
    }
    return true;
  }

  void _applyThreadSyncEventSideEffect(JsonMap event) {
    final type = readString(event, 'type');
    if (type == 'turn_started') {
      final threadId = readString(event, 'threadId');
      if (threadId.isNotEmpty) {
        activeTurnStartedAt[threadId] = _eventTime(event);
        _startWorkingTimer();
      }
      return;
    }
    if (type == 'turn_completed') {
      final threadId = readString(event, 'threadId');
      if (threadId.isNotEmpty) {
        activeTurnStartedAt.remove(threadId);
      }
      return;
    }
    if (type == 'token_usage') {
      final threadId = readString(event, 'threadId');
      final usage = event['usage'];
      if (threadId.isNotEmpty && usage is JsonMap) {
        tokenUsageByThread[threadId] = usage;
      }
      return;
    }
    if (type == 'model_rerouted') {
      _applyModelReroute(event);
    }
  }

  void _applyThreadSyncEvent(JsonMap event) {
    final type = readString(event, 'type');
    switch (type) {
      case 'turn_started':
      case 'turn_completed':
      case 'token_usage':
      case 'model_rerouted':
        _applyThreadSyncEventSideEffect(event);
        return;
      case 'agent_delta':
        _appendAgentDelta(event);
        return;
      case 'plan_delta':
        _appendPlanDelta(event);
        return;
      case 'turn_plan_updated':
        _appendPlan(event);
        return;
      case 'turn_diff_updated':
        _appendTurnDiff(event);
        return;
      case 'item_started':
        _appendItemStarted(event);
        return;
      case 'item_completed':
        _appendItemCompleted(event);
        return;
      case 'item_delta':
        _appendItemDelta(event);
        return;
      case 'thread_event':
        if (_shouldDisplayThreadEvent(readString(event, 'method'))) {
          _appendThreadEvent(event);
        }
        return;
      case 'mcp_tool_progress':
        _appendMcpProgress(event);
        return;
      case 'warning':
      case 'error_notice':
        _pushNotice({
          'level': type == 'error_notice' ? 'error' : 'warning',
          'title': readString(
            event,
            'noticeKind',
            type == 'warning' ? '警告' : '错误',
          ),
          'message': readString(event, 'message', jsonEncode(event)),
          'threadId': readString(event, 'threadId'),
          'dismissKey': _dismissKeyForMessage(event),
        });
        return;
    }
  }

  TimelineEntry? _entryFromTurnPlan(JsonMap planEntry) {
    final turnId = readString(
      planEntry,
      'turnId',
      readString(planEntry, 'turn_id'),
    );
    final plan = _planStepsFromEntry(planEntry);
    if (turnId.isEmpty || plan.isEmpty) {
      return null;
    }
    final normalizedDetails = {...planEntry, 'plan': plan};
    return TimelineEntry(
      id: 'turn-plan:$turnId',
      type: 'turn_plan',
      title: '执行计划',
      role: 'assistant',
      text: readString(planEntry, 'explanation'),
      status: 'completed',
      turnId: turnId,
      meta: plan
          .map(_formatPlanStep)
          .where((item) => item.isNotEmpty)
          .toList(growable: false),
      createdAt: _normalizeTimestamp(
        readInt(
          planEntry,
          'updatedAt',
          readInt(
            planEntry,
            'createdAt',
            readInt(
              planEntry,
              'startedAt',
              DateTime.now().millisecondsSinceEpoch,
            ),
          ),
        ),
      ),
      sequence: readInt(planEntry, 'sequence'),
      details: normalizedDetails,
      raw: normalizedDetails,
    );
  }

  List<JsonMap> _planStepsFromEntry(JsonMap planEntry) {
    for (final key in ['plan', 'steps', 'items']) {
      final steps = _normalizePlanSteps(planEntry[key]);
      if (steps.isNotEmpty) {
        return steps;
      }
    }
    return const [];
  }

  List<JsonMap> _normalizePlanSteps(dynamic value) {
    if (value is! List) {
      return const [];
    }
    final result = <JsonMap>[];
    for (final rawItem in value) {
      if (rawItem is String) {
        final step = rawItem.trim();
        if (step.isNotEmpty) {
          result.add({'step': step, 'status': 'pending'});
        }
        continue;
      }
      final item = _asJsonMap(rawItem);
      if (item == null) {
        continue;
      }
      final step = readString(item, 'step')
          .ifEmpty(readString(item, 'text'))
          .ifEmpty(readString(item, 'title'))
          .ifEmpty(readString(item, 'description'))
          .ifEmpty(readString(item, 'message'))
          .trim();
      if (step.isEmpty) {
        continue;
      }
      result.add({
        ...item,
        'step': step,
        'status': readString(item, 'status').ifEmpty('pending'),
      });
    }
    return result;
  }

  TimelineEntry? _entryFromTurnDiff(JsonMap diffEntry) {
    final turnId = readString(diffEntry, 'turnId');
    final diff = readString(diffEntry, 'diff');
    if (turnId.isEmpty || diff.trim().isEmpty) {
      return null;
    }
    return TimelineEntry(
      id: 'turn-diff:$turnId',
      type: 'turn_diff',
      title: '轮次 Diff',
      role: 'system',
      text: '已恢复的差异快照',
      status: 'completed',
      turnId: turnId,
      patch: diff,
      createdAt: _normalizeTimestamp(
        readInt(
          diffEntry,
          'updatedAt',
          readInt(
            diffEntry,
            'createdAt',
            DateTime.now().millisecondsSinceEpoch,
          ),
        ),
      ),
      sequence: readInt(diffEntry, 'sequence'),
      details: diffEntry,
      raw: diffEntry,
    );
  }

  List<TimelineEntry> _mergeTurnDiffEntry(
    List<TimelineEntry> entries,
    TimelineEntry diffEntry,
  ) {
    if (diffEntry.turnId.isEmpty || diffEntry.patch.trim().isEmpty) {
      return _dedupeEntries(entries);
    }
    final next = entries
        .where(
          (entry) =>
              !(entry.turnId == diffEntry.turnId && entry.type == 'turn_diff'),
        )
        .toList(growable: true);
    final fileIndex = next.indexWhere(
      (entry) =>
          entry.turnId == diffEntry.turnId && entry.type == 'file_change',
    );
    if (fileIndex < 0) {
      next.add(diffEntry);
      return _dedupeEntries(next);
    }
    final fileEntry = next[fileIndex];
    next[fileIndex] = fileEntry.copyWith(
      patch: diffEntry.patch,
      details: {..._entryDetails(fileEntry), 'patch': diffEntry.patch},
    );
    return _dedupeEntries(next);
  }

  TimelineEntry? _entryFromSupplemental(JsonMap item) {
    final id = readString(item, 'id');
    final type = readString(item, 'type');
    if (id.isEmpty || type.isEmpty) {
      return null;
    }
    final turnId = readString(item, '_turnId');
    final createdAt = _normalizeTimestamp(
      readInt(
        item,
        'completedAt',
        readInt(
          item,
          'startedAt',
          readInt(item, 'createdAt', readInt(item, 'updatedAt')),
        ),
      ),
    );
    if (type == 'hookEvent') {
      final run = readMap(item, 'run');
      return TimelineEntry(
        id: id,
        type: 'hook',
        title: 'Hook',
        role: 'system',
        text: readString(
          run,
          'command',
        ).ifEmpty('Hook ${readString(item, 'phase', 'event')}'),
        status: readString(item, 'status', 'completed'),
        turnId: turnId,
        itemId: id,
        meta: [
          readString(item, 'phase'),
          readInt(run, 'exitCode', -999999) == -999999 ||
                  readInt(run, 'exitCode') == 0
              ? ''
              : '退出码 ${readInt(run, 'exitCode')}',
        ].where((entry) => entry.isNotEmpty).toList(growable: false),
        createdAt: createdAt,
        raw: item,
      );
    }
    if (type == 'guardianReview') {
      return TimelineEntry(
        id: id,
        type: 'guardian_review',
        title: 'Guardian 审查',
        role: 'system',
        text: _summarizeMap(readMap(item, 'review'))
            .ifEmpty(_summarizeMap(readMap(item, 'action')))
            .ifEmpty('Guardian 审查'),
        status: readString(item, 'status', 'completed'),
        turnId: turnId,
        itemId: id,
        meta: [
          readString(item, 'phase'),
          readString(item, 'decisionSource'),
        ].where((entry) => entry.isNotEmpty).toList(growable: false),
        createdAt: createdAt,
        raw: item,
      );
    }
    if (type == 'pendingUserMessage') {
      final text = _extractText(item['text'])
          .ifEmpty(_extractText(item['content']))
          .ifEmpty(_extractText(item['input']))
          .ifEmpty(_extractText(item['message']));
      if (text.isEmpty) {
        return null;
      }
      return TimelineEntry(
        id: readString(item, 'entryId', 'pending-user:$id'),
        type: 'message',
        title: '你',
        role: 'user',
        text: text,
        status: readString(item, 'status', 'completed'),
        turnId: turnId,
        itemId: id,
        createdAt: createdAt,
        raw: item,
      );
    }
    return null;
  }

  String _formatPlanStep(JsonMap item) {
    final step = readString(item, 'step')
        .ifEmpty(readString(item, 'text'))
        .ifEmpty(readString(item, 'title'))
        .ifEmpty(readString(item, 'description'))
        .ifEmpty(readString(item, 'message'));
    if (step.isEmpty) {
      return '';
    }
    final status = readString(item, 'status');
    return status.isEmpty ? step : '${_formatStatusText(status)} · $step';
  }

  String _formatStatusText(String status) {
    return switch (status.replaceAll(RegExp(r'[\s_-]'), '').toLowerCase()) {
      'completed' || 'done' || 'success' || 'succeeded' => '已完成',
      'inprogress' || 'running' || 'active' => '进行中',
      'failed' || 'error' => '失败',
      'cancelled' || 'canceled' || 'aborted' || 'declined' => '已中断',
      'pendingapproval' => '待批准',
      'pending' => '待处理',
      _ => status,
    };
  }

  String _timelineTypeForItem(String type) {
    return switch (type) {
      'userMessage' ||
      'user_message' ||
      'agentMessage' ||
      'agent_message' ||
      'assistantMessage' ||
      'assistant_message' ||
      'message' => 'message',
      'commandExecution' => 'command',
      'fileChange' => 'file_change',
      'contextCompaction' ||
      'context_compaction' ||
      'compaction' => 'context_compaction',
      'hookPrompt' => 'hook',
      'mcpToolCall' => 'mcp_tool',
      'dynamicToolCall' => 'dynamic_tool',
      'collabAgentToolCall' => 'collab_tool',
      'webSearch' => 'web_search',
      'imageView' => 'image_view',
      'imageGeneration' => 'image_generation',
      'enteredReviewMode' || 'exitedReviewMode' => 'review_mode',
      _ => type.ifEmpty('item_delta'),
    };
  }

  bool _isUserMessageItem(String type, String role) {
    return type == 'userMessage' ||
        type == 'user_message' ||
        (type == 'message' && role == 'user');
  }

  bool _isAssistantMessageItem(String type, String role) {
    return type == 'agentMessage' ||
        type == 'agent_message' ||
        type == 'assistantMessage' ||
        type == 'assistant_message' ||
        (type == 'message' && role == 'assistant');
  }

  String _roleForItem(String type, JsonMap item) {
    final role = readString(item, 'role');
    if (role.isNotEmpty) {
      return role == 'assistant' ? 'assistant' : role;
    }
    if (type == 'userMessage' || type == 'user_message') {
      return 'user';
    }
    if (type == 'agentMessage' ||
        type == 'agent_message' ||
        type == 'assistantMessage' ||
        type == 'assistant_message' ||
        type == 'reasoning' ||
        type == 'plan') {
      return 'assistant';
    }
    return 'system';
  }

  List<String> _itemMeta(String type, JsonMap item) {
    final values = <String>[];
    if (type == 'commandExecution') {
      values.add(readString(item, 'cwd'));
      final exitCode = item['exitCode'];
      if (exitCode is num && exitCode.round() != 0) {
        values.add('退出码 ${exitCode.round()}');
      }
      final output = readString(
        item,
        'output',
      ).ifEmpty(readString(item, 'aggregatedOutput'));
      if (output.isNotEmpty) {
        values.add('输出 ${output.length} 字符');
      }
    } else if (type == 'mcpToolCall') {
      values.add(readString(item, 'server'));
      values.addAll(
        readMapList(
          item,
          'progressMessages',
        ).map((entry) => _summarizeMap(entry)),
      );
    } else if (type == 'collabAgentToolCall') {
      final receivers = item['receiverThreadIds'];
      if (receivers is List && receivers.isNotEmpty) {
        values.add('目标 ${receivers.length} 个线程');
      }
    } else if (type == 'webSearch') {
      final action = readMap(item, 'action');
      values.add(readString(action, 'type'));
      values.add(readString(item, 'url').ifEmpty(readString(action, 'url')));
    } else if (type == 'imageGeneration') {
      values.add(readString(item, 'revisedPrompt'));
    }
    return values
        .where((entry) => entry.trim().isNotEmpty)
        .toList(growable: false);
  }

  bool _shouldDisplayThreadEvent(String method) {
    if (method.isEmpty) {
      return false;
    }
    if (method == 'thread/goal/cleared') {
      return false;
    }
    return true;
  }

  String _formatMethodLabel(String method) {
    if (method.isEmpty) {
      return '事件';
    }
    const labels = {
      'process/outputDelta': '进程输出',
      'command/exec/outputDelta': '命令输出',
      'thread/deleted': '会话已删除',
      'thread/realtime/transcript/delta': '实时转录',
      'model/safetyBuffering/updated': '安全缓冲',
      'externalAgentConfig/import/progress': '外部代理导入进度',
      'externalAgentConfig/import/completed': '外部代理导入完成',
      'item/reasoning/summaryTextDelta': '推理',
      'item/reasoning/summaryPartAdded': '推理',
      'item/reasoning/textDelta': '推理',
      'item/commandExecution/outputDelta': '命令输出',
      'item/fileChange/outputDelta': '文件变更',
      'item/fileChange/patchUpdated': '补丁更新',
    };
    final direct = labels[method];
    if (direct != null) {
      return direct;
    }
    final parts = method
        .split('/')
        .where((part) => part.isNotEmpty)
        .toList(growable: false);
    final tail = parts.isEmpty ? method : parts.last;
    return tail.replaceAllMapped(
      RegExp(r'([a-z])([A-Z])'),
      (match) => '${match[1]} ${match[2]}',
    );
  }

  JsonMap _entryDetails(TimelineEntry? entry) {
    final details = entry?.details ?? entry?.raw;
    return details == null ? <String, dynamic>{} : JsonMap.from(details);
  }

  String _entryOutput(JsonMap details) {
    return readString(
      details,
      'output',
    ).ifEmpty(readString(details, 'aggregatedOutput'));
  }

  JsonMap _detailsWithOutput(JsonMap details, String output) {
    return {
      ...details,
      if (output.isNotEmpty) 'output': output,
      if (output.isNotEmpty) 'aggregatedOutput': output,
    };
  }

  List<String> _cleanProcessMeta(Iterable<String> values) {
    final seen = <String>{};
    final result = <String>[];
    for (final value in values) {
      final trimmed = value.trim();
      if (trimmed.isEmpty || trimmed == '退出码 0' || !seen.add(trimmed)) {
        continue;
      }
      result.add(trimmed);
    }
    return result;
  }

  void _setTurnStarted(String threadId, String turnId, int startedAt) {
    if (threadId.isEmpty) {
      return;
    }
    activeTurnStartedAt[threadId] = _normalizeTimestamp(startedAt);
    _promotePendingUserEntries(threadId, turnId, startedAt);
    _startWorkingTimer();
  }

  void _promotePendingUserEntries(
    String threadId,
    String turnId,
    int startedAt,
  ) {
    final resolvedTurnId = turnId.ifEmpty('$threadId:pending-turn');
    final entries = [
      ...(timelineByThread[threadId] ?? const <TimelineEntry>[]),
    ];
    var changed = false;
    for (var index = 0; index < entries.length; index += 1) {
      final entry = entries[index];
      if (entry.role != 'user' || entry.turnId != '$threadId:pending-turn') {
        continue;
      }
      entries[index] = TimelineEntry(
        id: entry.id,
        type: entry.type,
        title: entry.title,
        role: entry.role,
        text: entry.text,
        status: entry.status,
        turnId: resolvedTurnId,
        itemId: entry.itemId,
        meta: entry.meta,
        patch: entry.patch,
        changes: entry.changes,
        attachments: entry.attachments,
        createdAt: entry.createdAt == 0
            ? _normalizeTimestamp(startedAt)
            : entry.createdAt,
        sequence: entry.sequence,
        partial: entry.partial,
        details: entry.details,
        raw: entry.raw,
      );
      changed = true;
    }
    if (changed) {
      timelineByThread[threadId] = _dedupeEntries(entries);
    }
  }

  void _setTurnCompleted(String threadId, String turnId) {
    if (threadId.isEmpty) {
      return;
    }
    final wasRunning = activeTurnStartedAt.containsKey(threadId);
    activeTurnStartedAt.remove(threadId);
    final entries = [
      ...(timelineByThread[threadId] ?? const <TimelineEntry>[]),
    ];
    var changed = false;
    for (var index = 0; index < entries.length; index += 1) {
      final entry = entries[index];
      if (turnId.isNotEmpty && entry.turnId != turnId) {
        continue;
      }
      if (entry.partial ||
          entry.status == 'running' ||
          entry.status == 'in_progress' ||
          entry.status == 'inProgress') {
        entries[index] = entry.copyWith(
          partial: false,
          status: entry.status.isEmpty || entry.status == 'running'
              ? 'completed'
              : entry.status,
        );
        changed = true;
      }
    }
    if (changed) {
      timelineByThread[threadId] = entries;
    }
    if (wasRunning) {
      unawaited(_showTurnCompletedNotification(threadId, turnId));
    }
  }

  Future<void> _showTurnCompletedNotification(
    String threadId,
    String turnId,
  ) async {
    if (appInForeground) {
      return;
    }
    final key = '$threadId:${turnId.ifEmpty('turn')}';
    if (!_completedTurnNotifications.add(key)) {
      return;
    }
    final index = sessions.indexWhere((item) => item.threadId == threadId);
    final sessionName = index >= 0 ? sessions[index].name.trim() : '';
    final name = sessionName.isEmpty ? '当前对话' : sessionName;
    try {
      await bridge.showNotification(
        id: key.hashCode & 0x7fffffff,
        title: 'Codex 任务已完成',
        body: '$name 已完成',
      );
    } catch (_) {
      // Notification permission may be denied. The timeline still has the result.
    }
  }

  void _restoreActiveTurn(String threadId, dynamic turns) {
    if (turns is! List) {
      return;
    }
    for (final rawTurn in turns.reversed.whereType<JsonMap>()) {
      final status = readString(rawTurn, 'status');
      if (status == 'in_progress' ||
          status == 'inProgress' ||
          status == 'running') {
        activeTurnStartedAt[threadId] = _normalizeTimestamp(
          readInt(rawTurn, 'startedAt'),
        );
        _startWorkingTimer();
        return;
      }
    }
    activeTurnStartedAt.remove(threadId);
  }

  void _appendAgentDelta(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final rawItemId = readString(event, 'itemId');
    final turnId = readString(event, 'turnId');
    final entryId = rawItemId.ifEmpty(
      '$threadId:${turnId.ifEmpty('turn')}:assistant',
    );
    final itemId = rawItemId.ifEmpty(entryId);
    final delta = readString(event, 'delta');
    if (threadId.isEmpty || delta.isEmpty) {
      return;
    }
    final entries = [
      ...(timelineByThread[threadId] ?? const <TimelineEntry>[]),
    ];
    final index = entries.indexWhere(
      (entry) =>
          entry.id == entryId ||
          (rawItemId.isNotEmpty && entry.id == 'agent-$rawItemId') ||
          (entry.type == 'message' &&
              entry.itemId == itemId &&
              entry.role == 'assistant'),
    );
    if (index >= 0) {
      final current = entries[index];
      entries[index] = TimelineEntry(
        id: entryId,
        type: 'message',
        title: 'Codex',
        role: 'assistant',
        text: current.text + delta,
        status: current.status,
        turnId: current.turnId.ifEmpty(turnId),
        itemId: itemId,
        meta: current.meta,
        patch: current.patch,
        changes: current.changes,
        attachments: current.attachments,
        createdAt: current.createdAt,
        sequence: current.sequence,
        partial: true,
        details: current.details,
        raw: current.raw,
      );
    } else {
      entries.add(
        TimelineEntry(
          id: entryId,
          type: 'message',
          title: 'Codex',
          role: 'assistant',
          text: delta,
          turnId: turnId,
          itemId: itemId,
          createdAt: _eventTime(event),
          partial: true,
          raw: event,
        ),
      );
    }
    timelineByThread[threadId] = _dedupeEntries(entries);
  }

  void _appendPlan(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final entry = _entryFromTurnPlan(event);
    if (entry != null) {
      _appendEntry(threadId, entry);
    }
  }

  void _appendPlanDelta(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final itemId = readString(
      event,
      'itemId',
      '${readString(event, 'turnId', 'turn')}:plan-live',
    );
    final id = 'plan:$itemId';
    final current = _findEntry(threadId, id);
    _appendEntry(
      threadId,
      TimelineEntry(
        id: id,
        type: 'plan',
        title: '计划草稿',
        role: 'assistant',
        text: '${current?.text ?? ''}${readString(event, 'delta')}',
        status: 'running',
        turnId: readString(event, 'turnId'),
        itemId: itemId,
        meta: const ['流式输出中'],
        createdAt: current?.createdAt ?? _eventTime(event),
        partial: true,
        raw: event,
      ),
    );
  }

  void _appendTurnDiff(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final entry = _entryFromTurnDiff(event);
    if (entry != null) {
      timelineByThread[threadId] = _mergeTurnDiffEntry([
        ...(timelineByThread[threadId] ?? const <TimelineEntry>[]),
      ], entry);
    }
  }

  void _appendItemStarted(JsonMap event) {
    final item = _asJsonMap(event['item']);
    if (item != null) {
      final entry = _entryFromItem(
        item,
        readString(event, 'turnId'),
        _eventTime(event),
      );
      if (entry == null) {
        return;
      }
      _appendEntry(
        readString(event, 'threadId'),
        entry.copyWith(partial: true),
      );
    }
  }

  void _appendItemCompleted(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final item = _asJsonMap(event['item']);
    if (item == null) {
      return;
    }
    final itemType = readString(item, 'type');
    final itemId = readString(
      item,
      'id',
      readString(event, 'itemId', readString(event, 'turnId', 'assistant')),
    );
    if (_isAssistantMessageItem(itemType, readString(item, 'role'))) {
      final finalText = _messageItemText(item);
      final entryId = itemId.ifEmpty(
        '${threadId}:${readString(event, 'turnId', 'turn')}:assistant',
      );
      final existing =
          _findEntry(threadId, entryId) ??
          _findEntry(threadId, 'agent-$itemId') ??
          _findEntryByItem(threadId, itemId);
      final text = finalText.trim().isNotEmpty
          ? finalText
          : existing?.text ?? '';
      if (text.trim().isNotEmpty) {
        if (existing != null && existing.id != entryId) {
          _removeEntry(threadId, existing.id);
        }
        _appendEntry(
          threadId,
          TimelineEntry(
            id: entryId,
            type: 'message',
            title: 'Codex',
            role: 'assistant',
            text: text,
            status: 'completed',
            turnId: readString(event, 'turnId'),
            itemId: itemId.ifEmpty(entryId),
            createdAt: existing?.createdAt ?? _eventTime(event),
            details: item,
            raw: item,
          ),
        );
      }
      return;
    }
    final entry = _entryFromItem(
      item,
      readString(event, 'turnId'),
      _eventTime(event),
    );
    if (entry != null) {
      _appendEntry(threadId, entry.copyWith(partial: false));
    }
  }

  void _appendItemDelta(JsonMap event) {
    final method = readString(event, 'method');
    final threadId = readString(event, 'threadId');
    final turnId = readString(event, 'turnId');
    final rawItemId = readString(event, 'itemId');
    final id = rawItemId.ifEmpty(
      '$threadId:${turnId.ifEmpty('turn')}:${method.ifEmpty('item_delta')}',
    );
    final itemId = rawItemId.ifEmpty(id);
    final current =
        _findEntry(threadId, id) ?? _findEntryByItem(threadId, itemId);
    final delta = readString(
      event,
      'delta',
    ).ifEmpty(_extractText(event['part']));

    if (method == 'item/reasoning/summaryTextDelta' ||
        method == 'item/reasoning/summaryPartAdded' ||
        method == 'item/reasoning/textDelta') {
      _appendEntry(
        threadId,
        TimelineEntry(
          id: id,
          type: 'reasoning',
          title: '推理',
          role: 'assistant',
          text: '${current?.text ?? ''}$delta',
          status: 'running',
          turnId: turnId,
          itemId: itemId,
          meta: const ['流式输出中'],
          createdAt: current?.createdAt ?? _eventTime(event),
          partial: true,
          details: _entryDetails(current)
            ..addAll({'method': method, 'delta': delta}),
          raw: event,
        ),
      );
      return;
    }

    if (method == 'item/commandExecution/outputDelta') {
      final details = _entryDetails(current);
      final nextOutput = '${_entryOutput(details)}$delta';
      final nextDetails = _detailsWithOutput(details, nextOutput);
      _appendEntry(
        threadId,
        TimelineEntry(
          id: id,
          type: 'command',
          title: current?.title ?? '命令',
          role: 'system',
          text:
              current?.text ??
              readString(
                nextDetails,
                'command',
              ).ifEmpty(readString(nextDetails, 'input')).ifEmpty('执行命令'),
          status: 'running',
          turnId: turnId,
          itemId: itemId,
          meta: _cleanProcessMeta([
            ...(current?.meta ?? const <String>[]),
            if (nextOutput.isNotEmpty) '输出 ${nextOutput.length} 字符',
          ]).takeLast(8),
          createdAt: current?.createdAt ?? _eventTime(event),
          partial: true,
          details: nextDetails,
          raw: event,
        ),
      );
      return;
    }

    if (method == 'item/fileChange/outputDelta' ||
        method == 'item/fileChange/patchUpdated') {
      final details = _entryDetails(current);
      final nextOutput = method == 'item/fileChange/outputDelta'
          ? '${_entryOutput(details)}$delta'
          : _entryOutput(details);
      final nextPatch = readString(event, 'patch').ifEmpty(
        nextOutput.trim().isNotEmpty ? nextOutput : current?.patch ?? '',
      );
      final nextDetails = _detailsWithOutput(details, nextOutput);
      _appendEntry(
        threadId,
        TimelineEntry(
          id: id,
          type: 'file_change',
          title: current?.title ?? '文件变更',
          role: 'system',
          text: current?.text ?? '文件变更处理中',
          status: 'running',
          turnId: turnId,
          itemId: itemId,
          patch: nextPatch,
          changes: readMapList(event, 'changes').isNotEmpty
              ? readMapList(event, 'changes')
              : current?.changes ?? const [],
          meta: _cleanProcessMeta(
            current?.meta ?? const <String>[],
          ).takeLast(8),
          createdAt: current?.createdAt ?? _eventTime(event),
          partial: true,
          details: nextDetails,
          raw: event,
        ),
      );
      return;
    }

    _appendEntry(
      threadId,
      TimelineEntry(
        id: id,
        type: 'item_delta',
        title: _formatMethodLabel(method.ifEmpty('item_delta')),
        role: 'system',
        text: delta
            .ifEmpty(readString(event, 'patch'))
            .ifEmpty(_summarizeMap(event)),
        status: 'running',
        turnId: turnId,
        itemId: itemId,
        patch: readString(event, 'patch'),
        changes: readMapList(event, 'changes'),
        meta: [method].where((item) => item.isNotEmpty).toList(growable: false),
        createdAt: current?.createdAt ?? _eventTime(event),
        partial: true,
        details: {
          'method': method,
          'delta': delta,
          if (event['part'] != null) 'part': event['part'],
          if (event['changes'] != null) 'changes': event['changes'],
          if (readString(event, 'patch').isNotEmpty)
            'patch': readString(event, 'patch'),
        },
        raw: event,
      ),
    );
  }

  void _appendThreadEvent(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final method = readString(event, 'method');
    final id = readString(
      event,
      'itemId',
      '$threadId:${readString(event, 'turnId', 'thread')}:$method',
    );
    final current = _findEntry(threadId, id);
    final params = event['params'] is JsonMap
        ? event['params'] as JsonMap
        : const <String, dynamic>{};
    final streaming =
        method == 'process/outputDelta' ||
        method == 'command/exec/outputDelta' ||
        method == 'thread/realtime/transcript/delta';
    final delta = readString(event, 'delta')
        .ifEmpty(readString(event, 'message'))
        .ifEmpty(_extractText(params['text']))
        .ifEmpty(_summarizeMap(params));
    final currentDetails = _entryDetails(current);
    final nextText = streaming ? '${current?.text ?? ''}$delta' : delta;
    _appendEntry(
      threadId,
      TimelineEntry(
        id: id,
        type: 'thread_event',
        title: _formatMethodLabel(method),
        role: 'system',
        text: nextText,
        status: readString(
          event,
          'status',
          streaming ? 'running' : 'completed',
        ),
        turnId: readString(event, 'turnId'),
        itemId: readString(event, 'itemId'),
        meta: [method].where((item) => item.isNotEmpty).toList(growable: false),
        createdAt: current?.createdAt ?? _eventTime(event),
        partial: streaming,
        details: {
          ...currentDetails,
          ...params,
          if (streaming && nextText.isNotEmpty) 'output': nextText,
          if (streaming && nextText.isNotEmpty) 'aggregatedOutput': nextText,
        },
        raw: event,
      ),
    );
  }

  void _appendHookEvent(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final run = readMap(event, 'run');
    final id = readString(
      run,
      'id',
      '$threadId:${readString(event, 'turnId', 'turn')}:${readString(event, 'type')}',
    );
    _appendEntry(
      threadId,
      TimelineEntry(
        id: id,
        type: 'hook',
        title: 'Hook',
        role: 'system',
        text: readString(run, 'command').ifEmpty(
          readString(event, 'type') == 'hook_started' ? 'Hook 开始' : 'Hook 完成',
        ),
        status: readString(
          run,
          'status',
          readString(event, 'type') == 'hook_started' ? 'running' : 'completed',
        ),
        turnId: readString(event, 'turnId'),
        itemId: id,
        meta: [
          readString(event, 'type') == 'hook_started' ? 'started' : 'completed',
          run['exitCode'] is num && (run['exitCode'] as num).round() != 0
              ? '退出码 ${(run['exitCode'] as num).round()}'
              : '',
        ].where((item) => item.isNotEmpty).toList(growable: false),
        createdAt: _eventTime(event),
        details: run,
        raw: event,
      ),
    );
  }

  void _appendGuardianEvent(JsonMap event) {
    final type = readString(event, 'type');
    _appendEntry(
      readString(event, 'threadId'),
      TimelineEntry(
        id: '${readString(event, 'threadId')}:${readString(event, 'turnId', 'turn')}:$type',
        type: 'guardian_review',
        title: 'Guardian 审查',
        role: 'system',
        text: type == 'guardian_review_started' ? '审查开始' : '审查完成',
        status: type == 'guardian_review_started' ? 'running' : 'completed',
        turnId: readString(event, 'turnId'),
        createdAt: _eventTime(event),
        raw: event,
      ),
    );
  }

  void _appendMcpProgress(JsonMap event) {
    final threadId = readString(event, 'threadId');
    final itemId = readString(
      event,
      'itemId',
      '${readString(event, 'turnId', 'turn')}:mcp-progress',
    );
    final id = itemId;
    final current = _findEntry(threadId, id);
    final nextMeta = _cleanProcessMeta([
      ...(current?.meta ?? const <String>[]),
      readString(event, 'message'),
    ]).takeLast(6);
    _appendEntry(
      threadId,
      TimelineEntry(
        id: id,
        type: 'mcp_tool_progress',
        title: 'MCP 工具',
        role: 'system',
        text: current?.text ?? '工具运行中',
        status: 'running',
        turnId: readString(event, 'turnId'),
        itemId: itemId,
        meta: nextMeta,
        createdAt: current?.createdAt ?? _eventTime(event),
        partial: true,
        details: event,
        raw: event,
      ),
    );
  }

  void _appendEntry(String threadId, TimelineEntry entry) {
    if (threadId.isEmpty) {
      return;
    }
    final entries = [
      ...(timelineByThread[threadId] ?? const <TimelineEntry>[]),
    ];
    final semanticKey = _entrySemanticKey(entry);
    final index = entries.indexWhere(
      (item) =>
          item.id == entry.id ||
          (entry.itemId.isNotEmpty && item.id == 'agent-${entry.itemId}') ||
          (semanticKey.isNotEmpty && _entrySemanticKey(item) == semanticKey),
    );
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.add(entry);
    }
    entries.sort(_compareTimelineEntries);
    timelineByThread[threadId] = _dedupeEntries(entries);
  }

  void _handleNotification(JsonMap message) {
    final method = readString(message, 'method');
    final params = message['params'];
    if (method == 'account/rateLimits/updated' ||
        method == 'skills/changed' ||
        method == 'thread/settings/updated' ||
        method == 'externalAgentConfig/import/progress') {
      return;
    }
    final paramsMap = params is JsonMap ? params : const <String, dynamic>{};
    _pushNotice({
      'level': _notificationLevel(method, paramsMap),
      'title': _notificationTitle(method),
      'message': params is JsonMap
          ? _notificationMessage(method, params)
          : params?.toString() ?? method,
      'threadId': readString(paramsMap, 'threadId'),
      'dismissKey': _dismissKeyForMessage(message),
    });
    final threadId = readString(paramsMap, 'threadId');
    if (threadId.isNotEmpty &&
        (method == 'guardianWarning' || method.startsWith('turn/'))) {
      _appendNoticeEvent(
        threadId,
        _notificationTitle(method),
        _notificationMessage(method, paramsMap),
        _notificationLevel(method, paramsMap),
      );
    }
  }

  void _handleErrorMessage(JsonMap message) {
    if (readString(message, 'code') == 'AUTH_FAILED') {
      unawaited(_handleAuthFailed(readString(message, 'message')));
      return;
    }
    final threadId = readString(message, 'threadId');
    final clientMessageId = readString(message, 'clientMessageId');
    if (threadId.isNotEmpty && clientMessageId.isNotEmpty) {
      _removeEntry(threadId, 'local-user:$clientMessageId');
    }
    final text = readString(message, 'message', jsonEncode(message));
    if (threadId.isNotEmpty) {
      _appendNoticeEvent(threadId, '请求错误', text, 'error');
    } else {
      _pushNotice({'level': 'error', 'title': '请求错误', 'message': text});
    }
  }

  Future<void> _handleAuthFailed(String message) async {
    if (_reauthenticating) {
      return;
    }
    _reauthenticating = true;
    try {
      await _socket?.close();
      cookie = '';
      connectionStatus = 'idle';
      await bridge.remove('cookie');
      if (token.trim().isEmpty) {
        errorMessage = message.ifEmpty('登录已过期，请重新登录。');
        notifyListeners();
        return;
      }
      errorMessage = '登录已过期，正在重新登录...';
      notifyListeners();
      await login();
    } finally {
      _reauthenticating = false;
    }
  }

  void _applyModelReroute(JsonMap message) {
    final threadId = readString(message, 'threadId');
    final toModel = readString(message, 'toModel');
    if (threadId.isEmpty || toModel.isEmpty) {
      return;
    }
    final next = [...sessions];
    final index = next.indexWhere((item) => item.threadId == threadId);
    if (index >= 0) {
      final session = next[index];
      next[index] = SessionItem(
        threadId: session.threadId,
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        windowStatus: session.windowStatus,
        approvalPolicy: session.approvalPolicy,
        sandboxMode: session.sandboxMode,
        model: toModel,
        reasoningEffort: session.reasoningEffort,
        tokenUsage: session.tokenUsage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      );
      sessions = next;
    }
    final prefs = prefsByThread[threadId];
    if (prefs != null) {
      prefsByThread[threadId] = prefs.copyWith(model: toModel);
    }
  }

  void _appendNoticeEvent(
    String threadId,
    String title,
    String text,
    String level,
  ) {
    if (threadId.isEmpty || text.trim().isEmpty) {
      return;
    }
    _appendEntry(
      threadId,
      TimelineEntry(
        id: 'notice:$threadId:${DateTime.now().microsecondsSinceEpoch}',
        type: 'notice',
        title: title,
        role: 'system',
        text: text,
        status: level == 'error'
            ? 'error'
            : level == 'warning'
            ? 'warning'
            : 'completed',
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }

  void _pushNotice(JsonMap notice) {
    final message = readString(notice, 'message');
    final title = readString(notice, 'title', '通知');
    if (message.trim().isEmpty && title.trim().isEmpty) {
      return;
    }
    final dismissKey = readString(notice, 'dismissKey');
    if (dismissKey.isNotEmpty && dismissedNoticeKeys.contains(dismissKey)) {
      return;
    }
    final id = readString(notice, 'id')
        .ifEmpty(dismissKey)
        .ifEmpty('notice:${DateTime.now().microsecondsSinceEpoch}');
    notices.removeWhere(
      (item) =>
          readString(item, 'id').isNotEmpty && readString(item, 'id') == id,
    );
    notices.insert(0, {
      ...notice,
      'id': id,
      'createdAt': notice['createdAt'] ?? DateTime.now().millisecondsSinceEpoch,
    });
    if (notices.length > 40) {
      notices = notices.take(40).toList(growable: true);
    }
  }

  TimelineEntry? _findEntry(String threadId, String id) {
    if (id.isEmpty) {
      return null;
    }
    for (final entry in timelineByThread[threadId] ?? const <TimelineEntry>[]) {
      if (entry.id == id) {
        return entry;
      }
    }
    return null;
  }

  TimelineEntry? _findEntryByItem(String threadId, String itemId) {
    if (itemId.isEmpty) {
      return null;
    }
    for (final entry in timelineByThread[threadId] ?? const <TimelineEntry>[]) {
      if (entry.itemId == itemId) {
        return entry;
      }
    }
    return null;
  }

  void _removeEntry(String threadId, String entryId) {
    final entries = timelineByThread[threadId];
    if (entries == null) {
      return;
    }
    timelineByThread[threadId] = entries
        .where((entry) => entry.id != entryId)
        .toList(growable: false);
  }

  void _startWorkingTimer() {
    _workingTimer ??= Timer.periodic(
      const Duration(seconds: 1),
      (_) => notifyListeners(),
    );
  }

  List<TimelineEntry> _dedupeEntries(List<TimelineEntry> entries) {
    final result = <TimelineEntry>[];
    final indexById = <String, int>{};
    final indexBySemantic = <String, int>{};
    for (final entry in entries) {
      final semanticKey = _entrySemanticKey(entry);
      final existingIndex =
          indexById[entry.id] ??
          (semanticKey.isEmpty ? null : indexBySemantic[semanticKey]);
      if (existingIndex == null) {
        indexById[entry.id] = result.length;
        if (semanticKey.isNotEmpty) {
          indexBySemantic[semanticKey] = result.length;
        }
        result.add(entry);
        continue;
      }
      final merged = _mergeDuplicateEntry(result[existingIndex], entry);
      result[existingIndex] = merged;
      indexById[merged.id] = existingIndex;
      final mergedSemanticKey = _entrySemanticKey(merged);
      if (mergedSemanticKey.isNotEmpty) {
        indexBySemantic[mergedSemanticKey] = existingIndex;
      }
    }
    return _dropDuplicateOptimisticUserEntries(result)
      ..sort(_compareTimelineEntries);
  }

  String _entrySemanticKey(TimelineEntry entry) {
    if (entry.type == 'message' &&
        entry.role == 'user' &&
        entry.turnId.isNotEmpty &&
        entry.text.trim().isNotEmpty) {
      return 'message:user:${entry.turnId}:${entry.text.trim()}:${_attachmentSignature(entry.attachments)}';
    }
    if (entry.itemId.isEmpty || entry.type.isEmpty) {
      return '';
    }
    return '${entry.type}:${entry.role}:${entry.itemId}';
  }

  List<TimelineEntry> _dropDuplicateOptimisticUserEntries(
    List<TimelineEntry> entries,
  ) {
    return entries
        .where((entry) {
          if (!entry.id.startsWith('local-user:') || entry.role != 'user') {
            return true;
          }
          final text = entry.text.trim();
          final attachments = _attachmentSignature(entry.attachments);
          return !entries.any((candidate) {
            if (candidate.id == entry.id ||
                candidate.id.startsWith('local-user:') ||
                candidate.role != 'user') {
              return false;
            }
            if (candidate.text.trim() != text ||
                _attachmentSignature(candidate.attachments) != attachments) {
              return false;
            }
            if (!entry.turnId.endsWith(':pending-turn') &&
                candidate.turnId.isNotEmpty &&
                entry.turnId.isNotEmpty) {
              return candidate.turnId == entry.turnId;
            }
            return (candidate.createdAt - entry.createdAt).abs() <=
                const Duration(minutes: 10).inMilliseconds;
          });
        })
        .toList(growable: false);
  }

  String _attachmentSignature(List<AttachmentItem> attachments) {
    return attachments
        .map(
          (item) => item.id
              .ifEmpty(item.filePath)
              .ifEmpty(item.url)
              .ifEmpty(item.name),
        )
        .where((value) => value.isNotEmpty)
        .join(',');
  }

  TimelineEntry _mergeDuplicateEntry(
    TimelineEntry current,
    TimelineEntry incoming,
  ) {
    final currentIsLocal = current.id.startsWith('local-user:');
    final incomingIsLocal = incoming.id.startsWith('local-user:');
    final currentSettled = !current.partial && current.status != 'running';
    final incomingSettled = !incoming.partial && incoming.status != 'running';
    final preferIncoming = !currentIsLocal && incomingIsLocal
        ? false
        : currentIsLocal && !incomingIsLocal
        ? true
        : currentSettled != incomingSettled
        ? incomingSettled
        : incoming.text.length != current.text.length
        ? incoming.text.length > current.text.length
        : incoming.createdAt >= current.createdAt;
    final primary = preferIncoming ? incoming : current;
    final secondary = preferIncoming ? current : incoming;
    final text = primary.text.isEmpty
        ? secondary.text
        : secondary.text.length > primary.text.length
        ? secondary.text
        : primary.text;
    return primary.copyWith(
      text: text,
      status: primary.status.isNotEmpty ? primary.status : secondary.status,
      patch: primary.patch.isNotEmpty ? primary.patch : secondary.patch,
      meta: primary.meta.isNotEmpty
          ? _cleanProcessMeta(primary.meta)
          : _cleanProcessMeta(secondary.meta),
      changes: primary.changes.isNotEmpty ? primary.changes : secondary.changes,
      attachments: primary.attachments.isNotEmpty
          ? primary.attachments
          : secondary.attachments,
      details: primary.details ?? secondary.details,
      raw: primary.raw ?? secondary.raw,
    );
  }

  ComposerPrefs? _prefsFromSession(SessionItem? session) {
    if (session == null) {
      return null;
    }
    if (session.model.isEmpty &&
        session.reasoningEffort.isEmpty &&
        session.approvalPolicy.isEmpty &&
        session.sandboxMode.isEmpty) {
      return null;
    }
    return ComposerPrefs(
      model: session.model,
      reasoningEffort: session.reasoningEffort.ifEmpty(
        defaultPrefs.reasoningEffort,
      ),
      approvalPolicy: session.approvalPolicy.ifEmpty(
        defaultPrefs.approvalPolicy,
      ),
      sandboxMode: session.sandboxMode.ifEmpty(defaultPrefs.sandboxMode),
    );
  }

  int _normalizeTimestamp(int value) {
    if (value <= 0) {
      return DateTime.now().millisecondsSinceEpoch;
    }
    return value < 100000000000 ? value * 1000 : value;
  }

  int _eventTime(JsonMap event) => _normalizeTimestamp(
    readInt(
      event,
      'startedAt',
      readInt(
        event,
        'completedAt',
        readInt(
          event,
          'createdAt',
          readInt(event, 'updatedAt', DateTime.now().millisecondsSinceEpoch),
        ),
      ),
    ),
  );

  int _compareTimelineEntries(TimelineEntry left, TimelineEntry right) {
    final timeCompare = left.createdAt.compareTo(right.createdAt);
    if (timeCompare != 0) {
      return timeCompare;
    }
    if (left.sequence != 0 || right.sequence != 0) {
      return left.sequence.compareTo(right.sequence);
    }
    return left.id.compareTo(right.id);
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
    if (type == 'agentMessage' ||
        type == 'agent_message' ||
        type == 'assistantMessage' ||
        type == 'assistant_message') {
      return 'Codex';
    }
    if (type == 'userMessage' || type == 'user_message') {
      return '你';
    }
    return type.ifEmpty(readString(item, 'id', '事件'));
  }

  String _messageItemText(JsonMap item) {
    return _extractText(item['text'])
        .ifEmpty(_extractText(item['content']))
        .ifEmpty(_extractText(item['input']))
        .ifEmpty(_extractText(item['output']))
        .ifEmpty(_extractText(item['message']))
        .ifEmpty(_extractText(item['parts']));
  }

  String _itemText(JsonMap item) {
    final type = readString(item, 'type');
    if (type == 'contextCompaction' ||
        type == 'context_compaction' ||
        type == 'compaction') {
      return _extractText(item['summary'])
          .ifEmpty(_extractText(item['text']))
          .ifEmpty(_extractText(item['encrypted_content']))
          .ifEmpty('上下文已压缩');
    }
    return readString(item, 'text')
        .ifEmpty(readString(item, 'command'))
        .ifEmpty(readString(item, 'input'))
        .ifEmpty(readString(item, 'output'))
        .ifEmpty(readString(item, 'aggregatedOutput'))
        .ifEmpty(readString(item, 'message'))
        .ifEmpty(readString(item, 'patch'))
        .ifEmpty(_extractText(item['content']))
        .ifEmpty(_extractText(item['parts']))
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
      return value
          .map(_extractText)
          .where((item) => item.trim().isNotEmpty)
          .join('\n');
    }
    final mapValue = _asJsonMap(value);
    if (mapValue != null) {
      final type = readString(mapValue, 'type');
      if (type == 'localImage' || type == 'image' || type == 'input_image') {
        return '';
      }
      for (final key in [
        'text',
        'outputText',
        'output_text',
        'inputText',
        'input_text',
        'value',
        'message',
        'content',
        'parts',
        'output',
        'input',
        'summary',
      ]) {
        final extracted = _extractText(mapValue[key]);
        if (extracted.isNotEmpty) {
          return extracted;
        }
      }
      return _summarizeMap(mapValue);
    }
    return value.toString();
  }

  JsonMap? _asJsonMap(dynamic value) {
    if (value is JsonMap) {
      return value;
    }
    if (value is Map) {
      return JsonMap.from(value);
    }
    return null;
  }

  String _notificationTitle(String method) {
    if (method == 'mcpServer/startupStatus/updated') {
      return 'MCP 服务状态';
    }
    if (method == 'mcpServer/oauthLogin/completed') {
      return 'MCP OAuth';
    }
    if (method == 'account/updated') {
      return '账户更新';
    }
    if (method == 'account/login/completed') {
      return '账户登录';
    }
    if (method == 'guardianWarning') {
      return 'Guardian 警告';
    }
    if (method == 'configWarning' || method == 'windows/worldWritableWarning') {
      return '配置警告';
    }
    if (method == 'deprecationNotice' || method == 'deprecated') {
      return '弃用通知';
    }
    if (method == 'windowsSandbox/setupCompleted') {
      return 'Windows Sandbox';
    }
    if (method == 'remoteControl/status/changed') {
      return '远程控制状态';
    }
    if (method == 'turn/moderationMetadata') {
      return '内容审查元数据';
    }
    if (method == 'app/list/updated') {
      return '应用列表更新';
    }
    if (method == 'externalAgentConfig/import/completed') {
      return '外部代理配置导入完成';
    }
    if (method == 'externalAgentConfig/import/progress') {
      return '外部代理配置导入进度';
    }
    if (method == 'thread/deleted') {
      return '会话已删除';
    }
    if (method == 'model/safetyBuffering/updated') {
      return '安全缓冲';
    }
    if (method == 'fs/changed') {
      return '文件系统更新';
    }
    if (method == 'fuzzyFileSearch/sessionUpdated') {
      return '模糊搜索更新';
    }
    if (method == 'fuzzyFileSearch/sessionCompleted') {
      return '模糊搜索完成';
    }
    return method;
  }

  String _summarizeImportResults(JsonMap params) {
    final results = params['itemTypeResults'];
    var successes = 0;
    var failures = 0;
    if (results is List) {
      for (final result in results) {
        if (result is! JsonMap) {
          continue;
        }
        final successItems = result['successes'];
        final failureItems = result['failures'];
        if (successItems is List) {
          successes += successItems.length;
        }
        if (failureItems is List) {
          failures += failureItems.length;
        }
      }
    }
    return [
      readString(params, 'importId').isNotEmpty
          ? 'ID ${readString(params, 'importId')}'
          : '',
      successes > 0 ? '成功 $successes' : '',
      failures > 0 ? '失败 $failures' : '',
    ].where((item) => item.isNotEmpty).join(' · ');
  }

  String _notificationMessage(String method, JsonMap params) {
    if (method == 'mcpServer/startupStatus/updated') {
      return [
        readString(params, 'name', 'MCP'),
        readString(params, 'status', 'unknown'),
        readString(params, 'error'),
      ].where((item) => item.isNotEmpty).join(' · ');
    }
    if (method == 'mcpServer/oauthLogin/completed') {
      return '${readString(params, 'name', 'MCP')} · ${params['success'] == true ? '登录成功' : '登录失败'}${readString(params, 'error').isNotEmpty ? ' · ${readString(params, 'error')}' : ''}';
    }
    if (method == 'account/updated') {
      return [
        readString(params, 'authMode'),
        readString(params, 'planType'),
      ].where((item) => item.isNotEmpty).join(' · ').ifEmpty('账户信息已更新');
    }
    if (method == 'account/login/completed') {
      return '${params['success'] == true ? '登录成功' : '登录失败'}${readString(params, 'error').isNotEmpty ? ' · ${readString(params, 'error')}' : ''}';
    }
    if (method == 'guardianWarning') {
      return readString(params, 'message', 'Guardian 发出警告');
    }
    if (method == 'deprecationNotice' || method == 'deprecated') {
      return [
        readString(params, 'summary'),
        readString(params, 'details'),
      ].where((item) => item.isNotEmpty).join(' · ').ifEmpty('存在即将弃用的能力');
    }
    if (method == 'configWarning') {
      return [
        readString(params, 'summary'),
        readString(params, 'details'),
        readString(params, 'path'),
      ].where((item) => item.isNotEmpty).join(' · ').ifEmpty('配置存在警告');
    }
    if (method == 'windowsSandbox/setupCompleted') {
      return [
        readString(params, 'mode', 'sandbox'),
        params['success'] == true ? '设置完成' : '设置失败',
        readString(params, 'error'),
      ].where((item) => item.isNotEmpty).join(' · ');
    }
    if (method == 'remoteControl/status/changed') {
      return [
        readString(params, 'status'),
        readString(params, 'environmentId'),
      ].where((item) => item.isNotEmpty).join(' · ').ifEmpty('远程控制状态已更新');
    }
    if (method == 'turn/moderationMetadata') {
      final metadata = readMap(params, 'metadata');
      return [
            readString(metadata, 'category'),
            readString(metadata, 'outcome'),
            readString(metadata, 'action'),
          ]
          .where((item) => item.isNotEmpty)
          .join(' · ')
          .ifEmpty(_summarizeMap(metadata).ifEmpty('已收到审查元数据'));
    }
    if (method == 'app/list/updated') {
      final data = params['data'];
      return data is List ? '共 ${data.length} 个应用' : '应用列表已更新';
    }
    if (method == 'externalAgentConfig/import/completed') {
      return _summarizeImportResults(params).ifEmpty('外部代理配置已导入');
    }
    if (method == 'externalAgentConfig/import/progress') {
      return _summarizeImportResults(params).ifEmpty('外部代理配置导入中');
    }
    if (method == 'thread/deleted') {
      return readString(params, 'threadId', '会话已删除');
    }
    if (method == 'model/safetyBuffering/updated') {
      return [
        readString(params, 'model'),
        params['showBufferingUi'] == true ? '缓冲中' : '已结束',
        readString(params, 'fasterModel').isNotEmpty
            ? '可切换 ${readString(params, 'fasterModel')}'
            : '',
      ].where((item) => item.isNotEmpty).join(' · ');
    }
    if (method == 'fs/changed') {
      final changed = params['changedPaths'];
      final paths = changed is List
          ? changed.whereType<String>().take(2).toList(growable: false)
          : const <String>[];
      return [
        readString(params, 'watchId'),
        ...paths,
      ].where((item) => item.isNotEmpty).join(' · ').ifEmpty('文件系统事件');
    }
    if (method == 'fuzzyFileSearch/sessionUpdated') {
      final files = params['files'];
      return [
        readString(params, 'query'),
        files is List ? '${files.length} 个结果' : '',
      ].where((item) => item.isNotEmpty).join(' · ').ifEmpty('模糊搜索结果已更新');
    }
    if (method == 'fuzzyFileSearch/sessionCompleted') {
      return readString(params, 'sessionId').ifEmpty('模糊搜索已完成');
    }
    return _summarizeMap(params).ifEmpty('收到系统通知');
  }

  String _notificationLevel(String method, JsonMap params) {
    if (method == 'guardianWarning' ||
        method == 'configWarning' ||
        method == 'deprecationNotice' ||
        method == 'windows/worldWritableWarning') {
      return 'warning';
    }
    if ((method == 'mcpServer/startupStatus/updated' ||
            method == 'mcpServer/oauthLogin/completed' ||
            method == 'windowsSandbox/setupCompleted') &&
        (params['success'] == false ||
            readString(params, 'status') == 'failed' ||
            readString(params, 'error').isNotEmpty)) {
      return 'error';
    }
    if (method == 'account/login/completed' && params['success'] == false) {
      return 'error';
    }
    if (method == 'remoteControl/status/changed' &&
        readString(params, 'status') == 'errored') {
      return 'error';
    }
    return 'info';
  }

  String _summarizeMap(JsonMap map) {
    return map.entries
        .where((entry) => entry.value != null)
        .map((entry) => '${entry.key}: ${entry.value}')
        .take(4)
        .join(' · ');
  }

  String _dismissKeyForMessage(JsonMap message) {
    final type = readString(message, 'type');
    if (type == 'notification') {
      return 'notification:${readString(message, 'method')}:${_stableJson(message['params'])}';
    }
    return '$type:${readString(message, 'noticeId')}:${readString(message, 'threadId')}:${readString(message, 'noticeKind')}:${readString(message, 'message')}';
  }

  String _stableJson(dynamic value) {
    if (value == null) {
      return 'null';
    }
    if (value is String || value is num || value is bool) {
      return jsonEncode(value);
    }
    if (value is List) {
      return '[${value.map(_stableJson).join(',')}]';
    }
    if (value is Map) {
      final keys = value.keys.map((key) => key.toString()).toList()..sort();
      return '{${keys.map((key) => '${jsonEncode(key)}:${_stableJson(value[key])}').join(',')}}';
    }
    return jsonEncode(value.toString());
  }

  Set<String> _decodeStringSet(String raw) {
    try {
      final decoded = raw.trim().isEmpty ? const [] : jsonDecode(raw);
      if (decoded is List) {
        return decoded
            .whereType<String>()
            .map((item) => item.trim())
            .where((item) => item.isNotEmpty)
            .toSet();
      }
    } catch (_) {
      return {};
    }
    return {};
  }

  Future<void> _persistDismissedNoticeKeys() async {
    final values = dismissedNoticeKeys.toList(growable: false);
    final tail = values.length > 200
        ? values.sublist(values.length - 200)
        : values;
    await bridge.setString('dismissedNoticeKeys', jsonEncode(tail));
  }

  @override
  void dispose() {
    _workingTimer?.cancel();
    unawaited(_messageSub?.cancel());
    unawaited(_statusSub?.cancel());
    unawaited(_downloadProgressSub?.cancel());
    unawaited(_socket?.dispose());
    unawaited(_stopBackgroundKeepAlive(notify: false));
    _api?.close();
    super.dispose();
  }
}

String formatByteCount(int bytes) {
  final value = max(0, bytes).toDouble();
  const units = ['B', 'KB', 'MB', 'GB'];
  var unitIndex = 0;
  var scaled = value;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  if (unitIndex == 0) {
    return '${scaled.round()} ${units[unitIndex]}';
  }
  return '${scaled >= 100 ? scaled.toStringAsFixed(0) : scaled.toStringAsFixed(1)} ${units[unitIndex]}';
}

int normalizeUpdateDownloadConnectionLimit(int? value) {
  final raw = value ?? defaultUpdateDownloadConnectionLimit;
  return raw.clamp(1, maxUpdateDownloadConnectionLimit).toInt();
}

String extractVersionNameFromRelease({
  required String assetName,
  required String tagName,
  required String releaseName,
}) {
  for (final value in [assetName, tagName, releaseName]) {
    final match = RegExp(r'v(\d+(?:\.\d+){1,3})').firstMatch(value);
    if (match != null) {
      return match.group(1) ?? '';
    }
  }
  return '';
}

MobileUpdateInfo? extractMobileUpdateInfoFromReleaseHtml({
  required String html,
  required String finalUrl,
  Abi? currentAbi,
}) {
  final links =
      RegExp(
            r'''href=["']([^"']*?/ddddx/codex-remote-windows/releases/download/[^"']+?\.apk(?:\?[^"']*)?)["']''',
            caseSensitive: false,
          )
          .allMatches(html)
          .map((match) {
            final href = _decodeBasicHtmlEntities(match.group(1) ?? '');
            final url = _absoluteGithubUrl(href);
            final name = _fileNameFromUrl(url);
            return {'url': url, 'name': name};
          })
          .where((asset) {
            return asset['url']!.isNotEmpty && asset['name']!.endsWith('.apk');
          })
          .toList(growable: false);

  if (links.isEmpty) {
    return null;
  }
  final selectedName = selectBestMobileApkAssetName(
    links.map((asset) => asset['name'] ?? ''),
    currentAbi: currentAbi,
  );
  final selected = links.firstWhere(
    (asset) => asset['name'] == selectedName,
    orElse: () => links.first,
  );
  final apkName = selected['name'] ?? '';
  final apkUrl = selected['url'] ?? '';
  final tagName = _releaseTagFromUrl(
    apkUrl,
  ).ifEmpty(_releaseTagFromUrl(finalUrl));
  final releaseTitle = _releaseTitleFromHtml(html);
  final versionName = extractVersionNameFromRelease(
    assetName: apkName,
    tagName: tagName,
    releaseName: releaseTitle,
  );
  if (apkName.isEmpty || apkUrl.isEmpty || versionName.isEmpty) {
    return null;
  }
  final releaseUrl = tagName.isEmpty
      ? githubReleasePageUrl
      : 'https://github.com/ddddx/codex-remote-windows/releases/tag/$tagName';
  return MobileUpdateInfo(
    versionName: versionName,
    tagName: tagName,
    releaseUrl: releaseUrl,
    apkName: apkName,
    apkUrl: apkUrl,
  );
}

String extractGithubExpandedAssetsUrl({
  required String html,
  required String finalUrl,
}) {
  final match =
      RegExp(
        r'''src=["']([^"']*?/ddddx/codex-remote-windows/releases/expanded_assets/[^"']+)["']''',
        caseSensitive: false,
      ).firstMatch(html) ??
      RegExp(
        r'''["']([^"']*?/ddddx/codex-remote-windows/releases/expanded_assets/[^"']+)["']''',
        caseSensitive: false,
      ).firstMatch(html);
  if (match != null) {
    final src = _decodeBasicHtmlEntities(match.group(1) ?? '');
    return _absoluteGithubUrl(src);
  }
  final tagName = _releaseTagFromUrl(finalUrl);
  if (tagName.isEmpty) {
    return '';
  }
  return 'https://github.com/ddddx/codex-remote-windows/releases/expanded_assets/$tagName';
}

String selectBestMobileApkAssetName(
  Iterable<String> assetNames, {
  Abi? currentAbi,
}) {
  final apks = assetNames
      .map((name) => name.trim())
      .where((name) => name.toLowerCase().endsWith('.apk'))
      .toList(growable: false);
  if (apks.isEmpty) {
    return '';
  }
  final lowerByName = {for (final name in apks) name: name.toLowerCase()};
  for (final marker in _preferredApkAbiMarkers(currentAbi ?? Abi.current())) {
    for (final entry in lowerByName.entries) {
      if (entry.value.contains(marker)) {
        return entry.key;
      }
    }
  }
  for (final entry in lowerByName.entries) {
    if (entry.value.contains('-universal-')) {
      return entry.key;
    }
  }
  return apks.first;
}

List<String> _preferredApkAbiMarkers(Abi abi) {
  if (abi == Abi.androidArm64) {
    return const ['-arm64-v8a-', '-arm64-'];
  }
  if (abi == Abi.androidArm) {
    return const ['-armeabi-v7a-', '-armv7-', '-arm-'];
  }
  if (abi == Abi.androidX64) {
    return const ['-x86_64-', '-x64-'];
  }
  if (abi == Abi.androidIA32) {
    return const ['-x86-', '-ia32-'];
  }
  return const [];
}

String _absoluteGithubUrl(String href) {
  final trimmed = href.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return 'https:$trimmed';
  }
  if (trimmed.startsWith('/')) {
    return 'https://github.com$trimmed';
  }
  return trimmed;
}

String _fileNameFromUrl(String url) {
  try {
    final uri = Uri.parse(url);
    if (uri.pathSegments.isEmpty) {
      return '';
    }
    return Uri.decodeComponent(uri.pathSegments.last);
  } catch (_) {
    final path = url.split('?').first;
    final parts = path.split('/');
    return parts.isEmpty ? '' : Uri.decodeComponent(parts.last);
  }
}

String _releaseTagFromUrl(String url) {
  final match = RegExp(
    r'/releases/(?:download|tag)/([^/?#]+)',
    caseSensitive: false,
  ).firstMatch(url);
  return match == null ? '' : Uri.decodeComponent(match.group(1) ?? '');
}

String _releaseTitleFromHtml(String html) {
  final match = RegExp(
    r'<title>(.*?)</title>',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(html);
  return match == null ? '' : _decodeBasicHtmlEntities(match.group(1) ?? '');
}

String _decodeBasicHtmlEntities(String value) {
  return value
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');
}

String githubUpdateHttpErrorMessage(int statusCode) {
  if (statusCode == 403) {
    return 'GitHub 暂时拒绝更新检查（HTTP 403），请稍后重试或打开发布页查看。';
  }
  if (statusCode == 404) {
    return '没有找到 GitHub 发布页。';
  }
  return '检查更新失败：HTTP $statusCode';
}

String _mergeUniqueMessages(Iterable<String> messages) {
  final unique = <String>[];
  for (final message in messages) {
    final trimmed = message.trim();
    if (trimmed.isNotEmpty && !unique.contains(trimmed)) {
      unique.add(trimmed);
    }
  }
  return unique.isEmpty ? '检查更新失败。' : unique.join('；');
}

int compareVersionNames(String left, String right) {
  final leftParts = _versionParts(left);
  final rightParts = _versionParts(right);
  final maxLength = max(leftParts.length, rightParts.length);
  for (var index = 0; index < maxLength; index += 1) {
    final a = index < leftParts.length ? leftParts[index] : 0;
    final b = index < rightParts.length ? rightParts[index] : 0;
    if (a != b) {
      return a.compareTo(b);
    }
  }
  return 0;
}

List<int> _versionParts(String value) {
  final match = RegExp(r'(\d+(?:\.\d+){0,3})').firstMatch(value);
  final raw = match?.group(1) ?? '0';
  return raw
      .split('.')
      .map((item) => int.tryParse(item) ?? 0)
      .toList(growable: false);
}

extension _StringFallback on String {
  String ifEmpty(String fallback) => isEmpty ? fallback : this;
}

extension _ListTail<T> on List<T> {
  List<T> takeLast(int count) {
    if (length <= count) {
      return this;
    }
    return sublist(length - count);
  }
}
