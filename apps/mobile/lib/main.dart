import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';

import 'src/app_state.dart';
import 'src/models.dart';
import 'src/native_bridge.dart';

const int _initialRenderableLimit = 120;
const int _renderablePageSize = 120;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(CodexRemoteMobileApp(state: CodexAppState(NativeBridge())));
}

class CodexRemoteMobileApp extends StatefulWidget {
  const CodexRemoteMobileApp({super.key, required this.state});

  final CodexAppState state;

  @override
  State<CodexRemoteMobileApp> createState() => _CodexRemoteMobileAppState();
}

class _CodexRemoteMobileAppState extends State<CodexRemoteMobileApp>
    with WidgetsBindingObserver {
  late String _theme = widget.state.theme;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.state.addListener(_handleStateChanged);
    widget.state.setAppForeground(true);
    widget.state.initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.state.removeListener(_handleStateChanged);
    widget.state.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    widget.state.setAppForeground(state == AppLifecycleState.resumed);
  }

  void _handleStateChanged() {
    if (_theme == widget.state.theme) {
      return;
    }
    setState(() {
      _theme = widget.state.theme;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Codex Remote',
      theme: _themeFor(_theme),
      home: AnimatedBuilder(
        animation: widget.state,
        builder: (context, _) => AppShell(state: widget.state),
      ),
    );
  }
}

ThemeData _themeFor(String theme) {
  final seed = switch (theme) {
    'night' => const Color(0xff5bc0b5),
    'bay' => const Color(0xff0c6f7a),
    _ => const Color(0xff145c4f),
  };
  final brightness = theme == 'night' ? Brightness.dark : Brightness.light;
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: brightness),
    scaffoldBackgroundColor: theme == 'paper' ? const Color(0xfff3efe8) : null,
    cardTheme: const CardThemeData(
      margin: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
      ),
    ),
  );
}

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.state});

  final CodexAppState state;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  final TextEditingController _prompt = TextEditingController();
  final ScrollController _scroll = ScrollController();
  bool _showJumpToBottom = false;
  bool _hasUnreadBelow = false;
  bool _stickToBottom = true;
  String? _lastSessionId;
  String _lastTimelineSignature = '';

  CodexAppState get state => widget.state;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_handleTimelineScroll);
  }

  @override
  void dispose() {
    _scroll.removeListener(_handleTimelineScroll);
    _prompt.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (state.requiresSetup) {
      return SetupScreen(state: state);
    }
    final active = state.activeSession;
    _syncTimelineScrollState(active?.threadId);
    return Scaffold(
      drawer: SessionDrawer(state: state),
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              active?.name ?? 'Codex Remote',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              _statusLine(),
              style: Theme.of(context).textTheme.labelSmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '通知',
            icon: Badge(
              isLabelVisible: state.notices.isNotEmpty,
              label: Text('${state.notices.length}'),
              child: const Icon(Icons.notifications_outlined),
            ),
            onPressed: () => showNoticesSheet(context, state),
          ),
          IconButton(
            tooltip: '设置',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => showSettingsSheet(context, state),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (state.errorMessage.isNotEmpty)
              ErrorBanner(
                message: state.errorMessage,
                onClose: state.clearError,
              ),
            if (state.approvals.any(
              (item) =>
                  item.threadId.isEmpty ||
                  item.threadId == state.activeSessionId,
            ))
              ApprovalStrip(state: state),
            _buildTimelineArea(context, active),
            ComposerBar(
              state: state,
              controller: _prompt,
              onSubmit: () async {
                final text = _prompt.text;
                _prompt.clear();
                await state.sendPrompt(text);
                _stickToBottom = true;
                _scheduleScrollToBottom();
              },
            ),
          ],
        ),
      ),
    );
  }

  String _statusLine() {
    final parts = [
      state.connectionStatus,
      state.healthStatus == 'ok' ? '服务正常' : state.healthStatus,
      if (state.isWorking) state.workingLabel,
    ].where((item) => item.isNotEmpty).join(' · ');
    return parts;
  }

  Widget _buildTimelineArea(BuildContext context, SessionItem? active) {
    return Expanded(
      child: Stack(
        children: [
          Positioned.fill(
            child: active == null
                ? EmptySessionView(
                    onCreate: () => showNewSessionSheet(context, state),
                  )
                : TimelineView(state: state, controller: _scroll),
          ),
          if (_showJumpToBottom)
            Positioned(
              right: 16,
              bottom: 16,
              child: FloatingActionButton.extended(
                heroTag: 'timeline-jump-bottom',
                onPressed: _jumpToBottomFromButton,
                icon: const Icon(Icons.keyboard_arrow_down),
                label: Text(_hasUnreadBelow ? '新消息' : '回到底部'),
              ),
            ),
        ],
      ),
    );
  }

  void _syncTimelineScrollState(String? sessionId) {
    final entries = sessionId == null
        ? const <TimelineEntry>[]
        : state.activeTimeline
              .where(_shouldRenderTimelineEntry)
              .toList(growable: false);
    final signature = _timelineSignature(sessionId, entries);
    if (_lastSessionId != sessionId) {
      _lastSessionId = sessionId;
      _lastTimelineSignature = signature;
      _stickToBottom = true;
      _showJumpToBottom = false;
      _hasUnreadBelow = false;
      _scheduleScrollToBottom(animated: false);
      return;
    }
    if (_lastTimelineSignature == signature) {
      return;
    }
    final wasNearBottom = _stickToBottom || _isNearBottom();
    _lastTimelineSignature = signature;
    if (wasNearBottom) {
      _stickToBottom = true;
      _showJumpToBottom = false;
      _hasUnreadBelow = false;
      _scheduleScrollToBottom();
    } else {
      _stickToBottom = false;
      _showJumpToBottom = true;
      _hasUnreadBelow = true;
    }
  }

  String _timelineSignature(String? sessionId, List<TimelineEntry> entries) {
    final tail = entries.length <= 8
        ? entries
        : entries.sublist(entries.length - 8);
    final itemSignature = tail
        .map(
          (entry) => [
            entry.id,
            entry.text.length,
            entry.patch.length,
            entry.meta.length,
            entry.changes.length,
            entry.attachments.length,
            _entryDetailsSize(entry),
            entry.status,
            entry.partial,
          ].join(':'),
        )
        .join('|');
    return '${sessionId ?? ''}:${entries.length}:$itemSignature';
  }

  void _handleTimelineScroll() {
    if (!_scroll.hasClients) {
      return;
    }
    final nearBottom = _isNearBottom();
    _stickToBottom = nearBottom;
    final nextShow = !nearBottom;
    final nextUnread = nearBottom ? false : _hasUnreadBelow;
    if (nextShow == _showJumpToBottom && nextUnread == _hasUnreadBelow) {
      return;
    }
    setState(() {
      _showJumpToBottom = nextShow;
      _hasUnreadBelow = nextUnread;
    });
  }

  bool _isNearBottom() {
    if (!_scroll.hasClients) {
      return true;
    }
    final position = _scroll.position;
    return position.maxScrollExtent - position.pixels <= 96;
  }

  void _jumpToBottomFromButton() {
    setState(() {
      _stickToBottom = true;
      _showJumpToBottom = false;
      _hasUnreadBelow = false;
    });
    _scheduleScrollToBottom();
  }

  void _scheduleScrollToBottom({bool animated = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      _scrollToBottom(animated: animated);
      Future<void>.delayed(const Duration(milliseconds: 80), () {
        if (mounted && _stickToBottom) {
          _scrollToBottom(animated: false);
        }
      });
    });
  }

  void _scrollToBottom({bool animated = true}) {
    if (!_scroll.hasClients) {
      return;
    }
    final target = _scroll.position.maxScrollExtent;
    if (!animated || (_scroll.position.pixels - target).abs() < 2) {
      _scroll.jumpTo(target);
      return;
    }
    _scroll.animateTo(
      target,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
    );
  }
}

int _entryDetailsSize(TimelineEntry entry) {
  final details = entry.details ?? entry.raw;
  if (details == null || details.isEmpty) {
    return 0;
  }
  return jsonEncode(details).length;
}

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.state});

  final CodexAppState state;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  late final TextEditingController _server = TextEditingController(
    text: widget.state.serverUrl,
  );
  late final TextEditingController _token = TextEditingController(
    text: widget.state.token,
  );
  bool _serverEdited = false;
  bool _tokenEdited = false;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_syncControllerDrafts);
  }

  @override
  void didUpdateWidget(covariant SetupScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state == widget.state) {
      return;
    }
    oldWidget.state.removeListener(_syncControllerDrafts);
    widget.state.addListener(_syncControllerDrafts);
    _syncControllerDrafts();
  }

  @override
  void dispose() {
    widget.state.removeListener(_syncControllerDrafts);
    _server.dispose();
    _token.dispose();
    super.dispose();
  }

  void _syncControllerDrafts() {
    if (!_serverEdited && _server.text != widget.state.serverUrl) {
      _setControllerText(_server, widget.state.serverUrl);
    }
    if (!_tokenEdited && _token.text != widget.state.token) {
      _setControllerText(_token, widget.state.token);
    }
  }

  void _setControllerText(TextEditingController controller, String value) {
    controller.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
  }

  Future<void> _submitLogin() async {
    FocusScope.of(context).unfocus();
    widget.state.updateServerDraft(_server.text);
    widget.state.updateTokenDraft(_token.text);
    final ok = await widget.state.login();
    if (!ok && mounted) {
      _showStateError(context, widget.state);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Codex Remote')),
      body: AnimatedBuilder(
        animation: widget.state,
        builder: (context, _) => SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                '连接 Windows 服务',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                '手机端只作为客户端，Codex CLI 仍运行在你的 Windows 电脑上。',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _server,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: '服务地址',
                  hintText: 'http://电脑IP:18637',
                  prefixIcon: Icon(Icons.dns_outlined),
                  border: OutlineInputBorder(),
                ),
                onChanged: (value) {
                  _serverEdited = true;
                  widget.state.updateServerDraft(value);
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _token,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: '访问 Token',
                  prefixIcon: Icon(Icons.key_outlined),
                  border: OutlineInputBorder(),
                ),
                onChanged: (value) {
                  _tokenEdited = true;
                  widget.state.updateTokenDraft(value);
                },
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: widget.state.busy ? null : _submitLogin,
                icon: widget.state.busy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.login),
                label: Text(widget.state.busy ? '正在连接...' : '连接并登录'),
              ),
              if (widget.state.busy) ...[
                const SizedBox(height: 12),
                const Text('正在连接服务，请稍候。'),
              ],
              if (widget.state.errorMessage.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  widget.state.errorMessage,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class SessionDrawer extends StatelessWidget {
  const SessionDrawer({super.key, required this.state});

  final CodexAppState state;

  @override
  Widget build(BuildContext context) {
    final open = state.sessions
        .where((item) => !item.isClosed)
        .toList(growable: false);
    final closed = state.sessions
        .where((item) => item.isClosed)
        .toList(growable: false);
    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            ListTile(
              title: const Text('会话'),
              subtitle: Text('${state.sessions.length} 个会话'),
              trailing: IconButton(
                icon: const Icon(Icons.add),
                onPressed: () {
                  Navigator.pop(context);
                  showNewSessionSheet(context, state);
                },
              ),
            ),
            Expanded(
              child: ListView(
                children: [
                  ...open.map(
                    (item) => SessionTile(state: state, session: item),
                  ),
                  if (closed.isNotEmpty)
                    ExpansionTile(
                      leading: const Icon(Icons.archive_outlined),
                      title: const Text('未打开'),
                      subtitle: Text('${closed.length} 个会话'),
                      initiallyExpanded: false,
                      children: closed
                          .map(
                            (item) => SessionTile(state: state, session: item),
                          )
                          .toList(growable: false),
                    ),
                ],
              ),
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('退出登录'),
              onTap: () {
                Navigator.pop(context);
                state.logout();
              },
            ),
          ],
        ),
      ),
    );
  }
}

class SessionTile extends StatelessWidget {
  const SessionTile({super.key, required this.state, required this.session});

  final CodexAppState state;
  final SessionItem session;

  @override
  Widget build(BuildContext context) {
    final selected = state.activeSessionId == session.threadId;
    final unread = state.unreadThreadIds.contains(session.threadId);
    final running = state.activeTurnStartedAt.containsKey(session.threadId);
    return ListTile(
      selected: selected,
      leading: Badge(
        isLabelVisible: unread,
        smallSize: 8,
        child: Icon(
          running
              ? Icons.sync
              : session.isClosed
              ? Icons.radio_button_unchecked
              : Icons.trip_origin,
          size: 16,
        ),
      ),
      title: Text(session.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        [if (running) 'Working', _workspaceLabel(session.cwd)].join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: IconButton(
        tooltip: '关闭窗口',
        icon: const Icon(Icons.close),
        onPressed: () => state.closeSession(session.threadId),
      ),
      onTap: () {
        state.selectSession(session.threadId);
        Navigator.pop(context);
      },
    );
  }
}

class EmptySessionView extends StatelessWidget {
  const EmptySessionView({super.key, required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.forum_outlined, size: 42),
            const SizedBox(height: 12),
            Text('选择或新建会话', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onCreate,
              icon: const Icon(Icons.add),
              label: const Text('新建会话'),
            ),
          ],
        ),
      ),
    );
  }
}

class TimelineView extends StatefulWidget {
  const TimelineView({
    super.key,
    required this.state,
    required this.controller,
  });

  final CodexAppState state;
  final ScrollController controller;

  @override
  State<TimelineView> createState() => _TimelineViewState();
}

class _TimelineViewState extends State<TimelineView> {
  int _renderLimit = _initialRenderableLimit;
  String _sessionId = '';

  @override
  void initState() {
    super.initState();
    _sessionId = widget.state.activeSessionId;
  }

  @override
  void didUpdateWidget(TimelineView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_sessionId != widget.state.activeSessionId) {
      _sessionId = widget.state.activeSessionId;
      _renderLimit = _initialRenderableLimit;
    }
  }

  @override
  Widget build(BuildContext context) {
    final entries = widget.state.activeTimeline
        .where(_shouldRenderTimelineEntry)
        .toList(growable: false);
    if (entries.isEmpty) {
      return Center(
        child: Text('还没有消息', style: Theme.of(context).textTheme.bodyLarge),
      );
    }
    final hiddenCount = max(0, entries.length - _renderLimit);
    final visibleEntries = hiddenCount > 0
        ? entries.sublist(entries.length - _renderLimit)
        : entries;
    return ListView.builder(
      controller: widget.controller,
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      itemCount: visibleEntries.length + (hiddenCount > 0 ? 1 : 0),
      itemBuilder: (context, index) {
        if (hiddenCount > 0 && index == 0) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: OutlinedButton.icon(
              onPressed: () {
                setState(() {
                  _renderLimit += _renderablePageSize;
                });
              },
              icon: const Icon(Icons.keyboard_arrow_up),
              label: Text('加载更早 ${min(hiddenCount, _renderablePageSize)} 条'),
            ),
          );
        }
        final entryIndex = hiddenCount > 0 ? index - 1 : index;
        return TimelineCard(
          state: widget.state,
          entry: visibleEntries[entryIndex],
        );
      },
    );
  }
}

class TimelineCard extends StatelessWidget {
  const TimelineCard({super.key, required this.state, required this.entry});

  final CodexAppState state;
  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    if (_isMessageEntry(entry)) {
      return _MessageTimelineCard(state: state, entry: entry);
    }
    if (entry.type == 'turn_plan') {
      return _TurnPlanTimelineCard(entry: entry);
    }
    return _ProcessTimelineCard(entry: entry);
  }
}

class _MessageTimelineCard extends StatelessWidget {
  const _MessageTimelineCard({required this.state, required this.entry});

  final CodexAppState state;
  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final isUser = entry.role == 'user';
    final isAssistant = entry.role == 'assistant';
    final color = isUser
        ? Theme.of(context).colorScheme.primaryContainer
        : isAssistant
        ? Theme.of(context).colorScheme.surfaceContainerHighest
        : Theme.of(context).colorScheme.surfaceContainerLow;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth:
              MediaQuery.sizeOf(context).width *
              (isUser || isAssistant ? 0.88 : 0.96),
        ),
        child: Card(
          color: color,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(_entryIcon(entry), size: 16),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        [
                          entry.title,
                          _formatStatus(entry.status),
                        ].where((item) => item.isNotEmpty).join(' · '),
                        style: Theme.of(context).textTheme.labelMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (entry.partial)
                      const SizedBox.square(
                        dimension: 12,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                  ],
                ),
                if (entry.text.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _MarkdownText(text: entry.text, partial: entry.partial),
                ],
                if (entry.attachments.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  AttachmentStrip(state: state, attachments: entry.attachments),
                ],
                if (entry.meta.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: entry.meta
                        .map(
                          (item) => Chip(
                            label: Text(item),
                            visualDensity: VisualDensity.compact,
                          ),
                        )
                        .toList(growable: false),
                  ),
                ],
                if (entry.changes.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ...entry.changes
                      .take(4)
                      .map(
                        (change) => Row(
                          children: [
                            const Icon(Icons.description_outlined, size: 16),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                readString(
                                  change,
                                  'path',
                                  readString(change, 'name'),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Text(
                              _changeStats(change),
                              style: Theme.of(context).textTheme.labelSmall,
                            ),
                          ],
                        ),
                      ),
                ],
                if (entry.patch.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surface,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SelectableText(
                      entry.patch,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TurnPlanTimelineCard extends StatelessWidget {
  const _TurnPlanTimelineCard({required this.entry});

  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final steps = entry.meta;
    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.96,
        ),
        child: Card(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(_entryIcon(entry), size: 16),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        _processHeadline(entry),
                        style: Theme.of(context).textTheme.labelMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                if (entry.text.trim().isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    entry.text.trim(),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                if (steps.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  ...steps.map(
                    (step) => Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(_planStepIcon(step), size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              step,
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProcessTimelineCard extends StatelessWidget {
  const _ProcessTimelineCard({required this.entry});

  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final details = _processDetailWidgets(context, entry);
    final title = _processHeadline(entry);
    final summary = _processPreview(entry);
    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.96,
        ),
        child: Card(
          clipBehavior: Clip.antiAlias,
          color: _processColor(context, entry),
          child: details.isEmpty
              ? ListTile(
                  dense: true,
                  leading: Icon(_entryIcon(entry), size: 18),
                  title: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: summary.isEmpty
                      ? null
                      : Text(
                          summary,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                  trailing: entry.partial
                      ? const SizedBox.square(
                          dimension: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : null,
                )
              : Theme(
                  data: Theme.of(
                    context,
                  ).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 2,
                    ),
                    childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    leading: Icon(_entryIcon(entry), size: 18),
                    title: Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (entry.partial) ...[
                          const SizedBox(width: 8),
                          const SizedBox.square(
                            dimension: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ],
                      ],
                    ),
                    subtitle: summary.isEmpty
                        ? null
                        : Text(
                            summary,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                    children: details,
                  ),
                ),
        ),
      ),
    );
  }
}

bool _shouldRenderTimelineEntry(TimelineEntry entry) =>
    entry.type != 'reasoning' && entry.type != 'plan';

bool _isMessageEntry(TimelineEntry entry) =>
    entry.type == 'message' &&
    (entry.role == 'user' || entry.role == 'assistant');

Color _processColor(BuildContext context, TimelineEntry entry) {
  if (entry.status == 'error' || entry.status == 'failed') {
    return Theme.of(context).colorScheme.errorContainer;
  }
  if (entry.status == 'warning' || entry.status == 'pendingApproval') {
    return Theme.of(context).colorScheme.tertiaryContainer;
  }
  return Theme.of(context).colorScheme.surfaceContainerLow;
}

String _processHeadline(TimelineEntry entry) {
  final label = _timelineLabel(entry);
  if (entry.partial) {
    return '$label · 进行中';
  }
  final status = _formatStatus(entry.status);
  if (status.isNotEmpty && status != '完成') {
    return '$label · $status';
  }
  return label;
}

String _timelineLabel(TimelineEntry entry) {
  if (entry.title.trim().isNotEmpty) {
    return entry.title.trim();
  }
  return switch (entry.type) {
    'command' => '命令',
    'file_change' => '文件变更',
    'turn_diff' => '轮次 Diff',
    'mcp_tool' || 'mcp_tool_progress' => 'MCP 工具',
    'dynamic_tool' => '动态工具',
    'collab_tool' => '协作工具',
    'web_search' => 'Web 搜索',
    'thread_event' => '线程事件',
    'hook' => 'Hook',
    'guardian_review' => 'Guardian 审查',
    'context_compaction' => '上下文压缩',
    'notice' => '通知',
    _ => entry.type.isEmpty ? '事件' : entry.type,
  };
}

String _processPreview(TimelineEntry entry) {
  if (entry.type == 'command') {
    final details = _entryDetails(entry);
    return _compactOneLine(
      readString(details, 'command')
          .ifEmpty(readString(details, 'input'))
          .ifEmpty(entry.text)
          .ifEmpty('执行命令'),
    );
  }
  if (entry.type == 'file_change' || entry.type == 'turn_diff') {
    final changes = _renderableChanges(entry);
    if (changes.isNotEmpty) {
      final preview = changes
          .take(2)
          .map(
            (change) =>
                '${_fileChangePrefix(readString(change, 'kind'))} ${_basenameLike(readString(change, 'path', readString(change, 'name')))}'
                    .trim(),
          )
          .join(' · ');
      return changes.length > 2 ? '$preview 等 ${changes.length} 项' : preview;
    }
  }
  return _compactOneLine(
    entry.text.ifEmpty(entry.meta.join(' · ')).ifEmpty(_timelineLabel(entry)),
  );
}

List<Widget> _processDetailWidgets(BuildContext context, TimelineEntry entry) {
  final widgets = <Widget>[];
  final details = _entryDetails(entry);
  if (entry.type == 'command') {
    final command = readString(
      details,
      'command',
    ).ifEmpty(readString(details, 'input')).ifEmpty(entry.text);
    final cwd = readString(details, 'cwd');
    final output = readString(
      details,
      'output',
    ).ifEmpty(readString(details, 'aggregatedOutput'));
    if (command.trim().isNotEmpty) {
      widgets.add(_CodeBlock(text: command.trim()));
    }
    if (cwd.trim().isNotEmpty) {
      widgets.add(_DetailLine(text: 'cwd: $cwd'));
    }
    if (output.trim().isNotEmpty) {
      widgets.add(_CodeBlock(text: output.trim()));
    }
  } else {
    if (entry.text.trim().isNotEmpty) {
      widgets.add(_DetailLine(text: entry.text.trim()));
    }
  }

  final changes = _renderableChanges(entry);
  if (changes.isNotEmpty) {
    widgets.add(_FileChangeList(changes: changes));
  }

  final meta = _displayMeta(entry.meta);
  if (meta.isNotEmpty) {
    widgets.add(_MetaWrap(meta: meta));
  }

  final patch = entry.patch.trim();
  if (patch.isNotEmpty) {
    widgets.add(_CodeBlock(text: patch));
  }

  return widgets
      .map(
        (widget) =>
            Padding(padding: const EdgeInsets.only(top: 8), child: widget),
      )
      .toList(growable: false);
}

JsonMap _entryDetails(TimelineEntry entry) {
  final details = entry.details ?? entry.raw;
  return details == null ? const <String, dynamic>{} : details;
}

List<String> _displayMeta(List<String> meta) {
  final seen = <String>{};
  return meta
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty && item != '退出码 0' && seen.add(item))
      .toList(growable: false);
}

List<JsonMap> _renderableChanges(TimelineEntry entry) {
  if (entry.changes.isNotEmpty) {
    return entry.changes;
  }
  return _changesFromPatch(entry.patch);
}

List<JsonMap> _changesFromPatch(String patch) {
  final changes = <JsonMap>[];
  if (patch.trim().isEmpty) {
    return changes;
  }
  final lines = patch.replaceAll('\r\n', '\n').split('\n');
  String currentPath = '';
  var added = 0;
  var deleted = 0;

  void flush() {
    if (currentPath.isEmpty) {
      return;
    }
    changes.add({
      'path': currentPath,
      'kind': 'update',
      'addedLines': added,
      'deletedLines': deleted,
    });
    currentPath = '';
    added = 0;
    deleted = 0;
  }

  for (final line in lines) {
    if (line.startsWith('*** Add File:')) {
      flush();
      currentPath = line.substring('*** Add File:'.length).trim();
      continue;
    }
    if (line.startsWith('*** Delete File:')) {
      flush();
      currentPath = line.substring('*** Delete File:'.length).trim();
      continue;
    }
    if (line.startsWith('*** Update File:')) {
      flush();
      currentPath = line.substring('*** Update File:'.length).trim();
      continue;
    }
    if (line.startsWith('diff --git ')) {
      flush();
      final parts = line.split(RegExp(r'\s+'));
      currentPath = parts.length >= 4
          ? parts[3].replaceFirst(RegExp(r'^b/'), '')
          : line;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deleted += 1;
    }
  }
  flush();
  return changes;
}

String _fileChangePrefix(String kind) {
  final normalized = kind.trim().toLowerCase();
  if (normalized == 'add') {
    return '+ 新增';
  }
  if (normalized == 'delete') {
    return '- 删除';
  }
  return '~ 修改';
}

String _compactOneLine(String value) {
  final compact = value.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (compact.length <= 180) {
    return compact;
  }
  return '${compact.substring(0, 177)}...';
}

String _basenameLike(String path) {
  final trimmed = path.trim().replaceAll(RegExp(r'[\\/]+$'), '');
  if (trimmed.isEmpty) {
    return '未命名文件';
  }
  final parts = trimmed
      .split(RegExp(r'[\\/]'))
      .where((item) => item.isNotEmpty)
      .toList(growable: false);
  return parts.isEmpty ? trimmed : parts.last;
}

IconData _planStepIcon(String step) {
  if (step.startsWith('已完成')) {
    return Icons.check_circle_outline;
  }
  if (step.startsWith('进行中')) {
    return Icons.sync;
  }
  if (step.startsWith('失败')) {
    return Icons.error_outline;
  }
  return Icons.radio_button_unchecked;
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return _MarkdownText(text: text);
  }
}

class _CodeBlock extends StatelessWidget {
  const _CodeBlock({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: SelectableText(
        text,
        style: Theme.of(
          context,
        ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
      ),
    );
  }
}

class _MetaWrap extends StatelessWidget {
  const _MetaWrap({required this.meta});

  final List<String> meta;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: meta
          .map(
            (item) =>
                Chip(label: Text(item), visualDensity: VisualDensity.compact),
          )
          .toList(growable: false),
    );
  }
}

class _FileChangeList extends StatelessWidget {
  const _FileChangeList({required this.changes});

  final List<JsonMap> changes;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: changes
          .map(
            (change) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.description_outlined, size: 16),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '${_fileChangePrefix(readString(change, 'kind'))} ${readString(change, 'path', readString(change, 'name', '未命名文件'))}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    _changeStats(change),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ],
              ),
            ),
          )
          .toList(growable: false),
    );
  }
}

class _MarkdownText extends StatelessWidget {
  const _MarkdownText({required this.text, this.partial = false});

  final String text;
  final bool partial;

  @override
  Widget build(BuildContext context) {
    final normalized = text.replaceAll('\r\n', '\n');
    final lines = normalized.split('\n');
    final blocks = <Widget>[];
    final paragraph = <String>[];
    final code = <String>[];
    var inCode = false;

    void flushParagraph() {
      if (paragraph.isEmpty) {
        return;
      }
      blocks.add(
        _InlineMarkdownText(
          text: paragraph.join('\n'),
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      );
      paragraph.clear();
    }

    void flushCode() {
      blocks.add(_CodeBlock(text: code.join('\n')));
      code.clear();
    }

    for (final rawLine in lines) {
      final line = rawLine.replaceAll('\t', '  ');
      if (line.trimLeft().startsWith('```')) {
        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          flushParagraph();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        code.add(rawLine);
        continue;
      }
      if (line.trim().isEmpty) {
        flushParagraph();
        continue;
      }
      final heading = RegExp(r'^(#{1,3})\s+(.+)$').firstMatch(line);
      if (heading != null) {
        flushParagraph();
        final level = heading.group(1)!.length;
        final style = switch (level) {
          1 => Theme.of(context).textTheme.titleLarge,
          2 => Theme.of(context).textTheme.titleMedium,
          _ => Theme.of(context).textTheme.titleSmall,
        };
        blocks.add(
          _InlineMarkdownText(text: heading.group(2)!.trim(), style: style),
        );
        continue;
      }
      final quote = RegExp(r'^>\s?(.*)$').firstMatch(line);
      if (quote != null) {
        flushParagraph();
        blocks.add(
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(
                  color: Theme.of(context).colorScheme.outline,
                  width: 3,
                ),
              ),
            ),
            child: _InlineMarkdownText(
              text: quote.group(1)!.trim(),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        );
        continue;
      }
      final listItem = RegExp(r'^\s*(?:[-*+]|\d+\.)\s+(.+)$').firstMatch(line);
      if (listItem != null) {
        flushParagraph();
        blocks.add(
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(padding: EdgeInsets.only(top: 2), child: Text('•')),
              const SizedBox(width: 8),
              Expanded(
                child: _InlineMarkdownText(
                  text: listItem.group(1)!.trim(),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ],
          ),
        );
        continue;
      }
      paragraph.add(line);
    }
    if (inCode) {
      flushCode();
    }
    flushParagraph();

    if (partial) {
      blocks.add(Text('▌', style: Theme.of(context).textTheme.bodyMedium));
    }
    if (blocks.isEmpty) {
      return const SizedBox.shrink();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: blocks
          .map(
            (block) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: block,
            ),
          )
          .toList(growable: false),
    );
  }
}

class _InlineMarkdownText extends StatelessWidget {
  const _InlineMarkdownText({required this.text, this.style});

  final String text;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final base = style ?? Theme.of(context).textTheme.bodyMedium;
    return SelectableText.rich(
      TextSpan(style: base, children: _inlineSpans(context, text, base)),
    );
  }

  List<TextSpan> _inlineSpans(
    BuildContext context,
    String value,
    TextStyle? base,
  ) {
    final spans = <TextSpan>[];
    var index = 0;
    final pattern = RegExp(r'(`[^`]+`|\*\*[^*]+\*\*)');
    for (final match in pattern.allMatches(value)) {
      if (match.start > index) {
        spans.add(TextSpan(text: value.substring(index, match.start)));
      }
      final token = match.group(0)!;
      if (token.startsWith('`')) {
        spans.add(
          TextSpan(
            text: token.substring(1, token.length - 1),
            style: base?.copyWith(
              fontFamily: 'monospace',
              backgroundColor: Theme.of(
                context,
              ).colorScheme.surfaceContainerHighest,
            ),
          ),
        );
      } else {
        spans.add(
          TextSpan(
            text: token.substring(2, token.length - 2),
            style: base?.copyWith(fontWeight: FontWeight.w700),
          ),
        );
      }
      index = match.end;
    }
    if (index < value.length) {
      spans.add(TextSpan(text: value.substring(index)));
    }
    return spans;
  }
}

class AttachmentStrip extends StatelessWidget {
  const AttachmentStrip({
    super.key,
    required this.state,
    required this.attachments,
    this.onRemove,
  });

  final CodexAppState state;
  final List<AttachmentItem> attachments;
  final ValueChanged<AttachmentItem>? onRemove;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 88,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: attachments.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final item = attachments[index];
          return SizedBox(
            width: 92,
            child: Stack(
              children: [
                Positioned.fill(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: _attachmentImage(context, item),
                  ),
                ),
                Positioned(
                  left: 4,
                  right: 4,
                  bottom: 4,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      child: Text(
                        item.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ),
                ),
                if (onRemove != null)
                  Positioned(
                    top: 0,
                    right: 0,
                    child: IconButton.filled(
                      visualDensity: VisualDensity.compact,
                      iconSize: 14,
                      constraints: const BoxConstraints.tightFor(
                        width: 30,
                        height: 30,
                      ),
                      padding: EdgeInsets.zero,
                      onPressed: () => onRemove!(item),
                      icon: const Icon(Icons.close),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _attachmentImage(BuildContext context, AttachmentItem item) {
    if (item.url.isNotEmpty) {
      return Image.network(
        state.api.url(item.url).toString(),
        headers: state.cookie.isEmpty ? null : {'Cookie': state.cookie},
        fit: BoxFit.cover,
        errorBuilder: (context, _, _) => _attachmentFallback(context, item),
      );
    }
    return _attachmentFallback(context, item);
  }

  Widget _attachmentFallback(BuildContext context, AttachmentItem item) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.image_outlined),
            const SizedBox(height: 4),
            Text(
              item.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class ApprovalStrip extends StatelessWidget {
  const ApprovalStrip({super.key, required this.state});

  final CodexAppState state;

  @override
  Widget build(BuildContext context) {
    final pending = state.approvals
        .where(
          (item) =>
              item.threadId.isEmpty || item.threadId == state.activeSessionId,
        )
        .toList(growable: false);
    if (pending.isEmpty) {
      return const SizedBox.shrink();
    }
    return Material(
      color: Theme.of(context).colorScheme.tertiaryContainer,
      child: InkWell(
        onTap: () => showApprovalsSheet(context, state),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              const Icon(Icons.verified_user_outlined),
              const SizedBox(width: 10),
              Expanded(child: Text('${pending.length} 个待处理审批')),
              const Icon(Icons.expand_less),
            ],
          ),
        ),
      ),
    );
  }
}

class ComposerBar extends StatelessWidget {
  const ComposerBar({
    super.key,
    required this.state,
    required this.controller,
    required this.onSubmit,
  });

  final CodexAppState state;
  final TextEditingController controller;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final usage = _usageDisplay(state.activeTokenUsage);
    return Material(
      elevation: 8,
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        top: false,
        child: AnimatedSize(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    IconButton.filledTonal(
                      tooltip: '图片',
                      onPressed: state.activeSessionId.isEmpty
                          ? null
                          : state.pickAndUploadImage,
                      icon: const Icon(Icons.add_photo_alternate_outlined),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: controller,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.newline,
                        decoration: InputDecoration(
                          hintText: state.activeSessionId.isEmpty
                              ? '先选择会话'
                              : '给当前会话发送指令...',
                          border: const OutlineInputBorder(
                            borderRadius: BorderRadius.all(Radius.circular(14)),
                          ),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: '发送',
                      onPressed: state.activeSessionId.isEmpty
                          ? null
                          : onSubmit,
                      icon: const Icon(Icons.send),
                    ),
                  ],
                ),
                SlashCommandSuggestions(controller: controller),
                if (state.activeAttachments.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: AttachmentStrip(
                      state: state,
                      attachments: state.activeAttachments,
                      onRemove: (item) => state.removeAttachment(item.id),
                    ),
                  ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: state.toggleControls,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 8,
                          ),
                          child: Text(
                            _prefsSummary(state.activePrefs),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.labelMedium,
                          ),
                        ),
                      ),
                    ),
                    Tooltip(
                      message: usage.detail,
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: () => showUsageSheet(context, usage),
                        child: SizedBox.square(
                          dimension: 40,
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              CircularProgressIndicator(
                                value: usage.percentRemaining == null
                                    ? null
                                    : usage.percentRemaining! / 100,
                                strokeWidth: 4,
                              ),
                              Text(
                                usage.shortLabel,
                                style: Theme.of(context).textTheme.labelSmall,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                if (state.controlsExpanded) ComposerControls(state: state),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SlashCommandSuggestions extends StatelessWidget {
  const SlashCommandSuggestions({super.key, required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        final query = _slashQuery(value.text);
        if (query == null) {
          return const SizedBox.shrink();
        }
        final matches = _slashCommands
            .where((item) {
              final command = item['command'] ?? '';
              final aliases = item['aliases'] ?? '';
              return command.startsWith(query) ||
                  aliases.split(',').any((alias) => alias.startsWith(query));
            })
            .take(8)
            .toList(growable: false);
        if (matches.isEmpty) {
          return const SizedBox.shrink();
        }
        return SizedBox(
          height: 48,
          child: ListView.separated(
            padding: const EdgeInsets.only(top: 8),
            scrollDirection: Axis.horizontal,
            itemBuilder: (context, index) {
              final item = matches[index];
              final command = item['command'] ?? '';
              final args = item['args'] ?? '';
              return ActionChip(
                avatar: const Icon(Icons.shortcut, size: 16),
                label: Text('/$command${args.isNotEmpty ? ' $args' : ''}'),
                onPressed: () {
                  final next = '/$command${args.isNotEmpty ? ' ' : ' '}';
                  controller.value = TextEditingValue(
                    text: next,
                    selection: TextSelection.collapsed(offset: next.length),
                  );
                },
              );
            },
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemCount: matches.length,
          ),
        );
      },
    );
  }
}

class ComposerControls extends StatelessWidget {
  const ComposerControls({super.key, required this.state});

  final CodexAppState state;

  @override
  Widget build(BuildContext context) {
    final prefs = state.activePrefs;
    final models = ['', ...state.modelOptions.map((item) => item.model)];
    final modelValue = models.contains(prefs.model) ? prefs.model : '';
    return Column(
      children: [
        const Divider(height: 12),
        DropdownButtonFormField<String>(
          initialValue: modelValue,
          decoration: const InputDecoration(labelText: '模型', isDense: true),
          items: models
              .map(
                (value) => DropdownMenuItem(
                  value: value,
                  child: Text(value.isEmpty ? '默认' : value),
                ),
              )
              .toList(),
          onChanged: (value) =>
              state.updatePrefs(prefs.copyWith(model: value ?? '')),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: prefs.reasoningEffort,
                decoration: const InputDecoration(
                  labelText: '思考等级',
                  isDense: true,
                ),
                items:
                    const ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
                        .map(
                          (value) => DropdownMenuItem(
                            value: value,
                            child: Text(_reasoningLabel(value)),
                          ),
                        )
                        .toList(),
                onChanged: (value) => state.updatePrefs(
                  prefs.copyWith(reasoningEffort: value ?? 'medium'),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: _presetValue(prefs),
                decoration: const InputDecoration(
                  labelText: '权限预设',
                  isDense: true,
                ),
                items: const [
                  DropdownMenuItem(value: 'auto', child: Text('Default')),
                  DropdownMenuItem(
                    value: 'read-only',
                    child: Text('Read Only'),
                  ),
                  DropdownMenuItem(
                    value: 'full-access',
                    child: Text('Full Access'),
                  ),
                ],
                onChanged: (value) =>
                    state.applyPermissionPreset(value ?? 'auto'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: state.theme,
                decoration: const InputDecoration(
                  labelText: '主题',
                  isDense: true,
                ),
                items: const [
                  DropdownMenuItem(value: 'paper', child: Text('纸墨')),
                  DropdownMenuItem(value: 'bay', child: Text('海湾')),
                  DropdownMenuItem(value: 'night', child: Text('夜航')),
                ],
                onChanged: (value) => state.setTheme(value ?? 'paper'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => showWorkspaceSheet(context, state),
                icon: const Icon(Icons.folder_outlined),
                label: Text(
                  _workspaceLabel(state.workspacePath),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message, required this.onClose});

  final String message;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.errorContainer,
      child: ListTile(
        dense: true,
        leading: const Icon(Icons.error_outline),
        title: Text(message, maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: IconButton(icon: const Icon(Icons.close), onPressed: onClose),
      ),
    );
  }
}

void _showStateError(BuildContext context, CodexAppState state) {
  final message = state.errorMessage.trim();
  if (message.isEmpty) {
    return;
  }
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
  );
}

Future<void> showSettingsSheet(
  BuildContext context,
  CodexAppState state,
) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _SettingsSheet(state: state),
  );
}

class _SettingsSheet extends StatefulWidget {
  const _SettingsSheet({required this.state});

  final CodexAppState state;

  @override
  State<_SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends State<_SettingsSheet> {
  late final TextEditingController _server = TextEditingController(
    text: widget.state.serverUrl,
  );
  late final TextEditingController _token = TextEditingController(
    text: widget.state.token,
  );

  CodexAppState get state => widget.state;

  @override
  void initState() {
    super.initState();
    unawaited(state.loadAuthSessions());
  }

  @override
  void dispose() {
    _server.dispose();
    _token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) => Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.82,
          ),
          child: ListView(
            shrinkWrap: true,
            children: [
              Text('连接设置', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              TextField(
                controller: _server,
                decoration: const InputDecoration(
                  labelText: '服务地址',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _token,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Token',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: state.busy || state.healthStatus == 'loading'
                          ? null
                          : () async {
                              FocusScope.of(context).unfocus();
                              state.updateServerDraft(_server.text);
                              final ok = await state.refreshHealth();
                              if (!context.mounted) {
                                return;
                              }
                              if (ok) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('服务可访问'),
                                    behavior: SnackBarBehavior.floating,
                                  ),
                                );
                              } else {
                                _showStateError(context, state);
                              }
                            },
                      child: state.healthStatus == 'loading'
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('检查服务'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: state.busy
                          ? null
                          : () async {
                              FocusScope.of(context).unfocus();
                              state.updateServerDraft(_server.text);
                              state.updateTokenDraft(_token.text);
                              final ok = await state.login();
                              if (!context.mounted) {
                                return;
                              }
                              if (ok) {
                                Navigator.pop(context);
                              } else {
                                _showStateError(context, state);
                              }
                            },
                      child: state.busy
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('保存并登录'),
                    ),
                  ),
                ],
              ),
              if (state.busy || state.healthStatus == 'loading') ...[
                const SizedBox(height: 10),
                Text(state.busy ? '正在连接服务，请稍候。' : '正在检查服务。'),
              ],
              if (state.errorMessage.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  state.errorMessage,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 18),
              _buildUpdateSection(context),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '在线连接',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: state.authSessionsLoading
                        ? null
                        : state.loadAuthSessions,
                    icon: state.authSessionsLoading
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.refresh),
                    label: const Text('刷新'),
                  ),
                ],
              ),
              if (state.authSessions.isEmpty)
                const ListTile(
                  dense: true,
                  leading: Icon(Icons.devices_other_outlined),
                  title: Text('暂无在线连接'),
                )
              else
                ...state.authSessions.map(
                  (session) => ListTile(
                    dense: true,
                    leading: Icon(
                      session.current
                          ? Icons.phone_android
                          : Icons.devices_other_outlined,
                    ),
                    title: Text(
                      session.deviceName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      session.current
                          ? '当前设备'
                          : '最近活动 ${_formatDateTime(session.lastSeenAt)}',
                    ),
                    trailing: session.online
                        ? const Icon(
                            Icons.circle,
                            size: 10,
                            color: Colors.green,
                          )
                        : null,
                  ),
                ),
              if (state.cookie.isNotEmpty && state.authSessions.isNotEmpty) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: state.busy ? null : state.revokeAuthSessions,
                  icon: const Icon(Icons.logout),
                  label: const Text('全部踢下线'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildUpdateSection(BuildContext context) {
    final update = state.availableUpdate;
    final current = state.appVersionName.isEmpty
        ? '当前版本'
        : '当前版本 ${state.appVersionName}';
    final subtitle = update == null
        ? current
        : '$current · 最新 ${update.versionName}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('应用更新', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.system_update_alt),
          title: Text(
            update == null ? '检查 GitHub 发布页' : '发现新版本 ${update.versionName}',
          ),
          subtitle: Text(
            state.updateMessage.isEmpty ? subtitle : state.updateMessage,
          ),
        ),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: state.updateChecking
                    ? null
                    : () => state.checkForUpdate(),
                icon: state.updateChecking
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
                label: const Text('检查'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: state.updateDownloading
                    ? null
                    : update == null
                    ? null
                    : state.downloadAvailableUpdate,
                icon: state.updateDownloading
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download),
                label: const Text('下载安装'),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              tooltip: '发布页',
              onPressed: state.openReleasePage,
              icon: const Icon(Icons.open_in_new),
            ),
          ],
        ),
      ],
    );
  }
}

Future<void> showNewSessionSheet(
  BuildContext context,
  CodexAppState state,
) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _NewSessionSheet(state: state),
  );
}

class _NewSessionSheet extends StatefulWidget {
  const _NewSessionSheet({required this.state});

  final CodexAppState state;

  @override
  State<_NewSessionSheet> createState() => _NewSessionSheetState();
}

class _NewSessionSheetState extends State<_NewSessionSheet> {
  late final TextEditingController _name = TextEditingController(text: '新会话');
  late final TextEditingController _cwd = TextEditingController(
    text: widget.state.workspacePath,
  );

  CodexAppState get state => widget.state;

  @override
  void dispose() {
    _name.dispose();
    _cwd.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('新建会话', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: '名称',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _cwd,
            decoration: const InputDecoration(
              labelText: '工作区路径',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => showWorkspaceSheet(
                    context,
                    state,
                    onPick: (path) => _cwd.text = path,
                  ),
                  icon: const Icon(Icons.folder_outlined),
                  label: const Text('选择工作区'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  icon: const Icon(Icons.add),
                  label: const Text('创建'),
                  onPressed: () {
                    state.createSession(name: _name.text, cwd: _cwd.text);
                    Navigator.pop(context);
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

Future<void> showWorkspaceSheet(
  BuildContext context,
  CodexAppState state, {
  ValueChanged<String>? onPick,
}) async {
  await state.loadWorkspace(state.workspacePath);
  if (!context.mounted) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _WorkspaceSheet(state: state, onPick: onPick),
  );
}

class _WorkspaceSheet extends StatefulWidget {
  const _WorkspaceSheet({required this.state, this.onPick});

  final CodexAppState state;
  final ValueChanged<String>? onPick;

  @override
  State<_WorkspaceSheet> createState() => _WorkspaceSheetState();
}

class _WorkspaceSheetState extends State<_WorkspaceSheet> {
  final TextEditingController _folder = TextEditingController();

  CodexAppState get state => widget.state;

  @override
  void dispose() {
    _folder.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final listing = state.workspaceListing;
        return SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        listing?.path ?? state.workspacePath,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.check),
                      onPressed: () {
                        final path = listing?.path ?? state.workspacePath;
                        widget.onPick?.call(path);
                        state.workspacePath = path;
                        Navigator.pop(context);
                      },
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _folder,
                        decoration: const InputDecoration(
                          labelText: '新文件夹',
                          isDense: true,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.create_new_folder_outlined),
                      onPressed: () =>
                          state.createWorkspaceFolder(_folder.text),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  children: [
                    if ((listing?.parentPath ?? '').isNotEmpty)
                      ListTile(
                        leading: const Icon(Icons.arrow_upward),
                        title: const Text('上一级'),
                        onTap: () => state.loadWorkspace(listing!.parentPath),
                      ),
                    ...?listing?.entries.map(
                      (entry) => ListTile(
                        leading: const Icon(Icons.folder_outlined),
                        title: Text(entry.name),
                        subtitle: Text(
                          entry.path,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => state.loadWorkspace(entry.path),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

Future<void> showApprovalsSheet(
  BuildContext context,
  CodexAppState state,
) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final pending = state.approvals
            .where(
              (item) =>
                  item.threadId.isEmpty ||
                  item.threadId == state.activeSessionId,
            )
            .toList(growable: false);
        return SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              Text('待处理审批', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              ...pending.map(
                (request) => ApprovalCard(state: state, request: request),
              ),
            ],
          ),
        );
      },
    ),
  );
}

class ApprovalCard extends StatefulWidget {
  const ApprovalCard({super.key, required this.state, required this.request});

  final CodexAppState state;
  final ServerRequestItem request;

  @override
  State<ApprovalCard> createState() => _ApprovalCardState();
}

class _ApprovalCardState extends State<ApprovalCard> {
  final Map<String, TextEditingController> _answers = {};
  final TextEditingController _json = TextEditingController(
    text: '[{"type":"inputText","text":"ok"}]',
  );
  bool _toolSuccess = true;

  @override
  void dispose() {
    for (final controller in _answers.values) {
      controller.dispose();
    }
    _json.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;
    final special = _specialForm(context, request);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              request.displayTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            SelectableText(request.displayBody),
            if (request.cwd.isNotEmpty)
              Text(request.cwd, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 12),
            ...special,
            if (special.isEmpty)
              Wrap(
                spacing: 8,
                children:
                    (request.availableDecisions.isNotEmpty
                            ? request.availableDecisions
                            : const ['accept', 'decline'])
                        .map((decision) {
                          final index =
                              (request.availableDecisions.isNotEmpty
                                      ? request.availableDecisions
                                      : const ['accept', 'decline'])
                                  .indexOf(decision);
                          final onPressed = request.status == 'submitting'
                              ? null
                              : () => widget.state.respondApproval(
                                  request,
                                  _decisionResponse(decision),
                                );
                          return index == 0
                              ? FilledButton(
                                  onPressed: onPressed,
                                  child: Text(_decisionLabel(decision)),
                                )
                              : OutlinedButton(
                                  onPressed: onPressed,
                                  child: Text(_decisionLabel(decision)),
                                );
                        })
                        .toList(growable: false),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _specialForm(BuildContext context, ServerRequestItem request) {
    if (request.method == 'item/tool/requestUserInput' ||
        request.questions.isNotEmpty) {
      return [
        ...request.questions.map((question) {
          final id = readString(question, 'id', readString(question, 'header'));
          final controller = _answers.putIfAbsent(
            id,
            TextEditingController.new,
          );
          final options = question['options'] is List
              ? (question['options'] as List).whereType<JsonMap>().toList(
                  growable: false,
                )
              : const <JsonMap>[];
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  readString(
                    question,
                    'header',
                    readString(question, 'question', id),
                  ),
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                if (options.isNotEmpty)
                  ...options.map((option) {
                    final label = readString(option, 'label');
                    final checked = controller.text == label;
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        checked
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                      ),
                      title: Text(label),
                      subtitle: readString(option, 'description').isEmpty
                          ? null
                          : Text(readString(option, 'description')),
                      onTap: () => setState(() => controller.text = label),
                    );
                  }),
                if (options.isEmpty ||
                    question['isOther'] == true ||
                    question['isSecret'] == true)
                  TextField(
                    controller: controller,
                    obscureText: question['isSecret'] == true,
                    decoration: InputDecoration(
                      labelText: readString(question, 'question', id),
                      border: const OutlineInputBorder(),
                    ),
                  ),
              ],
            ),
          );
        }),
        FilledButton(
          onPressed: () {
            widget.state.respondApproval(request, {
              'answers': _answers.map(
                (key, value) => MapEntry(key, {
                  'answers': [value.text],
                }),
              ),
            });
          },
          child: const Text('提交回答'),
        ),
      ];
    }
    if (request.method == 'item/tool/call') {
      return [
        TextField(
          controller: _json,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'contentItems JSON',
            border: OutlineInputBorder(),
          ),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _toolSuccess,
          onChanged: (value) => setState(() => _toolSuccess = value ?? true),
          title: const Text('标记为成功'),
        ),
        FilledButton(
          onPressed: () {
            dynamic contentItems = [];
            try {
              contentItems = _json.text.trim().isEmpty
                  ? []
                  : jsonDecode(_json.text);
              if (contentItems is! List) {
                throw const FormatException('contentItems 必须是数组');
              }
            } catch (_) {
              widget.state.respondApproval(request, {
                'error': 'contentItems JSON 无效',
              });
              return;
            }
            widget.state.respondApproval(request, {
              'contentItems': contentItems,
              'success': _toolSuccess,
            });
          },
          child: const Text('提交结果'),
        ),
      ];
    }
    if (request.method == 'mcpServer/elicitation/request') {
      if (request.mode == 'url') {
        return [
          FilledButton(
            onPressed: () => widget.state.respondApproval(request, {
              'action': 'accept',
              'content': null,
              '_meta': request.raw['meta'],
            }),
            child: const Text('允许'),
          ),
          OutlinedButton(
            onPressed: () => widget.state.respondApproval(request, {
              'action': 'decline',
              'content': null,
            }),
            child: const Text('拒绝'),
          ),
        ];
      }
      final schema = request.requestedSchema.isNotEmpty
          ? request.requestedSchema
          : request.responseSchema;
      final properties = schema['properties'];
      final fields = properties is JsonMap
          ? properties
          : const <String, dynamic>{};
      return [
        ...fields.entries.map((entry) {
          final controller = _answers.putIfAbsent(
            entry.key,
            TextEditingController.new,
          );
          final fieldSpec = entry.value is JsonMap
              ? entry.value as JsonMap
              : const <String, dynamic>{};
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: TextField(
              controller: controller,
              keyboardType: _keyboardForSchema(fieldSpec),
              decoration: InputDecoration(
                labelText: readString(fieldSpec, 'title', entry.key),
                border: const OutlineInputBorder(),
              ),
            ),
          );
        }),
        Wrap(
          spacing: 8,
          children: [
            FilledButton(
              onPressed: () => widget.state.respondApproval(request, {
                'action': 'accept',
                'content': fields.map(
                  (key, spec) => MapEntry(
                    key,
                    _normalizeSchemaValue(
                      _answers[key]?.text ?? '',
                      spec is JsonMap ? spec : const <String, dynamic>{},
                    ),
                  ),
                ),
                '_meta': request.raw['meta'],
              }),
              child: const Text('提交'),
            ),
            OutlinedButton(
              onPressed: () => widget.state.respondApproval(request, {
                'action': 'decline',
                'content': null,
              }),
              child: const Text('拒绝'),
            ),
          ],
        ),
      ];
    }
    return const [];
  }
}

Future<void> showNoticesSheet(BuildContext context, CodexAppState state) async {
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => AnimatedBuilder(
      animation: state,
      builder: (context, _) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          Text('通知', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          if (state.notices.isEmpty) const ListTile(title: Text('暂无通知')),
          for (var i = 0; i < state.notices.length; i++)
            ListTile(
              leading: Icon(
                state.notices[i]['level'] == 'error'
                    ? Icons.error_outline
                    : Icons.info_outline,
              ),
              title: Text('${state.notices[i]['title'] ?? '通知'}'),
              subtitle: Text('${state.notices[i]['message'] ?? ''}'),
              trailing: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => state.dismissNotice(i),
              ),
            ),
        ],
      ),
    ),
  );
}

Future<void> showUsageSheet(BuildContext context, UsageDisplay usage) async {
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(usage.label, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(usage.detail),
        ],
      ),
    ),
  );
}

const List<Map<String, String>> _slashCommands = [
  {
    'command': 'goal',
    'args': '[objective]',
    'aliases': '',
    'description': 'set or view the goal',
  },
  {
    'command': 'compact',
    'args': '',
    'aliases': '',
    'description': 'summarize conversation',
  },
  {
    'command': 'rename',
    'args': '<name>',
    'aliases': '',
    'description': 'rename thread',
  },
  {
    'command': 'stop',
    'args': '',
    'aliases': 'clean',
    'description': 'stop background terminals',
  },
  {
    'command': 'review',
    'args': '',
    'aliases': '',
    'description': 'review current changes',
  },
  {
    'command': 'plan',
    'args': '',
    'aliases': '',
    'description': 'switch to Plan mode',
  },
  {
    'command': 'diff',
    'args': '',
    'aliases': '',
    'description': 'show git diff',
  },
  {
    'command': 'status',
    'args': '',
    'aliases': '',
    'description': 'show status',
  },
  {
    'command': 'model',
    'args': '',
    'aliases': '',
    'description': 'choose model',
  },
  {
    'command': 'permissions',
    'args': '',
    'aliases': '',
    'description': 'choose permissions',
  },
  {
    'command': 'new',
    'args': '',
    'aliases': '',
    'description': 'start a new chat',
  },
  {
    'command': 'resume',
    'args': '',
    'aliases': '',
    'description': 'resume chat',
  },
  {'command': 'fork', 'args': '', 'aliases': '', 'description': 'fork chat'},
  {
    'command': 'init',
    'args': '',
    'aliases': '',
    'description': 'create AGENTS.md',
  },
  {
    'command': 'copy',
    'args': '',
    'aliases': '',
    'description': 'copy last response',
  },
  {
    'command': 'mention',
    'args': '',
    'aliases': '',
    'description': 'mention a file',
  },
  {'command': 'skills', 'args': '', 'aliases': '', 'description': 'use skills'},
  {
    'command': 'mcp',
    'args': '',
    'aliases': '',
    'description': 'list MCP tools',
  },
  {'command': 'apps', 'args': '', 'aliases': '', 'description': 'manage apps'},
  {
    'command': 'plugins',
    'args': '',
    'aliases': '',
    'description': 'browse plugins',
  },
  {'command': 'logout', 'args': '', 'aliases': '', 'description': 'log out'},
  {
    'command': 'quit',
    'args': '',
    'aliases': 'exit',
    'description': 'exit Codex',
  },
];

String? _slashQuery(String value) {
  if (!value.startsWith('/') || value.contains('\n') || value.contains(' ')) {
    return null;
  }
  return value.substring(1).toLowerCase();
}

String _changeStats(JsonMap change) {
  final added = _num(change['addedLines']) ?? _num(change['added_lines']) ?? 0;
  final deleted =
      _num(change['deletedLines']) ?? _num(change['deleted_lines']) ?? 0;
  final parts = [
    if (added > 0) '+${added.round()}',
    if (deleted > 0) '-${deleted.round()}',
  ];
  return parts.join(' / ');
}

String _formatDateTime(int timestamp) {
  if (timestamp <= 0) {
    return '未知';
  }
  final dt = DateTime.fromMillisecondsSinceEpoch(
    timestamp < 100000000000 ? timestamp * 1000 : timestamp,
  );
  return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}

String _decisionLabel(dynamic decision) {
  if (decision is String) {
    return switch (decision) {
      'accept' || 'approved' => '批准',
      'acceptForSession' || 'approved_for_session' => '本会话内批准',
      'decline' || 'denied' => '拒绝',
      'cancel' => '取消',
      _ => decision,
    };
  }
  if (decision is JsonMap) {
    if (decision.containsKey('acceptWithExecpolicyAmendment')) {
      return '按策略批准';
    }
    if (decision.containsKey('acceptWithNetworkPolicyAmendments')) {
      return '批准网络权限';
    }
  }
  return '提交';
}

JsonMap _decisionResponse(dynamic decision) {
  return {'decision': decision};
}

TextInputType _keyboardForSchema(JsonMap schema) {
  final type = readString(schema, 'type');
  if (type == 'number' || type == 'integer') {
    return const TextInputType.numberWithOptions(decimal: true, signed: true);
  }
  return TextInputType.text;
}

dynamic _normalizeSchemaValue(String value, JsonMap schema) {
  final type = readString(schema, 'type', 'string');
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    return type == 'number' || type == 'integer' ? null : '';
  }
  if (type == 'number') {
    return num.tryParse(trimmed);
  }
  if (type == 'integer') {
    return int.tryParse(trimmed);
  }
  if (type == 'boolean') {
    return trimmed.toLowerCase() == 'true';
  }
  return trimmed;
}

IconData _entryIcon(TimelineEntry entry) {
  if (entry.title == '你') return Icons.person_outline;
  if (entry.title == 'Codex') return Icons.smart_toy_outlined;
  if (entry.type.contains('command')) return Icons.terminal_outlined;
  if (entry.type.contains('file')) return Icons.description_outlined;
  if (entry.type.contains('plan')) return Icons.checklist_outlined;
  return Icons.circle_outlined;
}

String _formatStatus(String status) {
  return switch (status) {
    'running' || 'in_progress' || 'inProgress' => '进行中',
    'completed' || 'idle' || 'ready' => '完成',
    'failed' || 'error' => '异常',
    'pending' => '待处理',
    _ => status,
  };
}

String _workspaceLabel(String value) {
  final trimmed = value.trim().replaceAll(RegExp(r'[\\/]+$'), '');
  if (trimmed.isEmpty) return '未设置工作区';
  final parts = trimmed
      .split(RegExp(r'[\\/]'))
      .where((item) => item.isNotEmpty)
      .toList();
  return parts.isEmpty ? trimmed : parts.last;
}

String _prefsSummary(ComposerPrefs prefs) {
  final model = prefs.model.isEmpty ? '默认模型' : prefs.model;
  return '$model · ${_reasoningLabel(prefs.reasoningEffort)} · ${_presetValue(prefs)}';
}

String _reasoningLabel(String value) {
  return switch (value) {
    'none' => '关闭',
    'minimal' => '极低',
    'low' => '低',
    'medium' => '中',
    'high' => '高',
    'xhigh' => '超高',
    _ => value,
  };
}

String _presetValue(ComposerPrefs prefs) {
  if (prefs.approvalPolicy == 'never' &&
      prefs.sandboxMode == 'danger-full-access')
    return 'full-access';
  if (prefs.sandboxMode == 'read-only') return 'read-only';
  return 'auto';
}

UsageDisplay _usageDisplay(JsonMap? value) {
  if (value == null) {
    return const UsageDisplay(label: '上下文', detail: '未统计', shortLabel: '--');
  }
  final nested = value['usage'] is JsonMap ? value['usage'] as JsonMap : value;
  final window = _num(
    nested['modelContextWindow'] ?? nested['model_context_window'],
  );
  final last = nested['last'] is JsonMap
      ? nested['last'] as JsonMap
      : const <String, dynamic>{};
  final total = _num(
    last['totalTokens'] ??
        last['total_tokens'] ??
        nested['totalTokens'] ??
        nested['total_tokens'],
  );
  if (window != null && window > 0 && total != null) {
    final used = ((total / window) * 100).round().clamp(0, 100);
    final remaining = 100 - used;
    return UsageDisplay(
      label: '上下文余量',
      detail:
          '剩余 $remaining% · ${max(window - total, 0).round()} / ${window.round()} tokens',
      percentRemaining: remaining,
      shortLabel: '$remaining%',
    );
  }
  if (total != null) {
    return UsageDisplay(
      label: '总量',
      detail: '总 ${total.round()}',
      shortLabel: '${total.round()}',
    );
  }
  return const UsageDisplay(label: '上下文', detail: '未统计', shortLabel: '--');
}

num? _num(dynamic value) {
  if (value is num) return value;
  if (value is String) return num.tryParse(value);
  return null;
}

class UsageDisplay {
  const UsageDisplay({
    required this.label,
    required this.detail,
    required this.shortLabel,
    this.percentRemaining,
  });

  final String label;
  final String detail;
  final String shortLabel;
  final int? percentRemaining;
}

extension _StringFallback on String {
  String ifEmpty(String fallback) => isEmpty ? fallback : this;
}
