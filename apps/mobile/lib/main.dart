import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';

import 'src/app_state.dart';
import 'src/models.dart';
import 'src/native_bridge.dart';

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

class _CodexRemoteMobileAppState extends State<CodexRemoteMobileApp> {
  late String _theme = widget.state.theme;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_handleStateChanged);
    widget.state.initialize();
  }

  @override
  void dispose() {
    widget.state.removeListener(_handleStateChanged);
    widget.state.dispose();
    super.dispose();
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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(8))),
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

  CodexAppState get state => widget.state;

  @override
  void dispose() {
    _prompt.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (state.cookie.isEmpty) {
      return SetupScreen(state: state);
    }
    final active = state.activeSession;
    return Scaffold(
      drawer: SessionDrawer(state: state),
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(active?.name ?? 'Codex Remote', maxLines: 1, overflow: TextOverflow.ellipsis),
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
            tooltip: '新建会话',
            icon: const Icon(Icons.add_comment_outlined),
            onPressed: () => showNewSessionSheet(context, state),
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
              ErrorBanner(message: state.errorMessage, onClose: state.clearError),
            if (state.approvals.any((item) => item.threadId.isEmpty || item.threadId == state.activeSessionId))
              ApprovalStrip(state: state),
            Expanded(
              child: active == null
                  ? EmptySessionView(onCreate: () => showNewSessionSheet(context, state))
                  : TimelineView(state: state, controller: _scroll),
            ),
            ComposerBar(
              state: state,
              controller: _prompt,
              onSubmit: () async {
                final text = _prompt.text;
                _prompt.clear();
                await state.sendPrompt(text);
                WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
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

  void _scrollToBottom() {
    if (!_scroll.hasClients) {
      return;
    }
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
    );
  }
}

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.state});

  final CodexAppState state;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  late final TextEditingController _server = TextEditingController(text: widget.state.serverUrl);
  late final TextEditingController _token = TextEditingController(text: widget.state.token);

  @override
  void dispose() {
    _server.dispose();
    _token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Codex Remote')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text('连接 Windows 服务', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text('手机端只作为客户端，Codex CLI 仍运行在你的 Windows 电脑上。', style: Theme.of(context).textTheme.bodyMedium),
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
              onChanged: widget.state.updateServerDraft,
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
              onChanged: widget.state.updateTokenDraft,
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: widget.state.busy
                  ? null
                  : () async {
                      widget.state.updateServerDraft(_server.text);
                      widget.state.updateTokenDraft(_token.text);
                      await widget.state.login();
                    },
              icon: widget.state.busy
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.login),
              label: const Text('连接并登录'),
            ),
            if (widget.state.errorMessage.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(widget.state.errorMessage, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
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
    final open = state.sessions.where((item) => !item.isClosed).toList(growable: false);
    final closed = state.sessions.where((item) => item.isClosed).toList(growable: false);
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
                  ...open.map((item) => SessionTile(state: state, session: item)),
                  if (closed.isNotEmpty)
                    ExpansionTile(
                      leading: const Icon(Icons.archive_outlined),
                      title: const Text('已关闭'),
                      subtitle: Text('${closed.length} 个会话'),
                      initiallyExpanded: false,
                      children: closed.map((item) => SessionTile(state: state, session: item)).toList(growable: false),
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
        child: Icon(running ? Icons.sync : session.isClosed ? Icons.radio_button_unchecked : Icons.trip_origin, size: 16),
      ),
      title: Text(session.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text([if (running) 'Working', _workspaceLabel(session.cwd)].join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis),
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
            FilledButton.icon(onPressed: onCreate, icon: const Icon(Icons.add), label: const Text('新建会话')),
          ],
        ),
      ),
    );
  }
}

class TimelineView extends StatelessWidget {
  const TimelineView({super.key, required this.state, required this.controller});

  final CodexAppState state;
  final ScrollController controller;

  @override
  Widget build(BuildContext context) {
    final entries = state.activeTimeline;
    if (entries.isEmpty) {
      return Center(
        child: Text('还没有消息', style: Theme.of(context).textTheme.bodyLarge),
      );
    }
    return ListView.builder(
      controller: controller,
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      itemCount: entries.length,
      itemBuilder: (context, index) => TimelineCard(state: state, entry: entries[index]),
    );
  }
}

class TimelineCard extends StatelessWidget {
  const TimelineCard({super.key, required this.state, required this.entry});

  final CodexAppState state;
  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final isUser = entry.role == 'user' || entry.title == '你';
    final isAssistant = entry.role == 'assistant' || entry.title == 'Codex';
    final color = isUser
        ? Theme.of(context).colorScheme.primaryContainer
        : isAssistant
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : Theme.of(context).colorScheme.surfaceContainerLow;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * (isUser || isAssistant ? 0.88 : 0.96)),
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
                        [entry.title, _formatStatus(entry.status)].where((item) => item.isNotEmpty).join(' · '),
                        style: Theme.of(context).textTheme.labelMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (entry.partial)
                      const SizedBox.square(dimension: 12, child: CircularProgressIndicator(strokeWidth: 2)),
                  ],
                ),
                if (entry.text.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  SelectableText(entry.text),
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
                    children: entry.meta.map((item) => Chip(label: Text(item), visualDensity: VisualDensity.compact)).toList(growable: false),
                  ),
                ],
                if (entry.changes.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ...entry.changes.take(4).map((change) => Row(
                        children: [
                          const Icon(Icons.description_outlined, size: 16),
                          const SizedBox(width: 6),
                          Expanded(child: Text(readString(change, 'path', readString(change, 'name')), maxLines: 1, overflow: TextOverflow.ellipsis)),
                          Text(_changeStats(change), style: Theme.of(context).textTheme.labelSmall),
                        ],
                      )),
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
                    child: SelectableText(entry.patch, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontFamily: 'monospace')),
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
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      child: Text(
                        item.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white, fontSize: 11),
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
                      constraints: const BoxConstraints.tightFor(width: 30, height: 30),
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
            Text(item.name, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
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
    final pending = state.approvals.where((item) => item.threadId.isEmpty || item.threadId == state.activeSessionId).toList(growable: false);
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
                      onPressed: state.activeSessionId.isEmpty ? null : state.pickAndUploadImage,
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
                          hintText: state.activeSessionId.isEmpty ? '先选择会话' : '给当前会话发送指令...',
                          border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(14))),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: '发送',
                      onPressed: state.activeSessionId.isEmpty ? null : onSubmit,
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
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
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
                                value: usage.percentRemaining == null ? null : usage.percentRemaining! / 100,
                                strokeWidth: 4,
                              ),
                              Text(usage.shortLabel, style: Theme.of(context).textTheme.labelSmall),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                if (state.controlsExpanded)
                  ComposerControls(state: state),
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
        final matches = _slashCommands.where((item) {
          final command = item['command'] ?? '';
          final aliases = item['aliases'] ?? '';
          return command.startsWith(query) || aliases.split(',').any((alias) => alias.startsWith(query));
        }).take(8).toList(growable: false);
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
          items: models.map((value) => DropdownMenuItem(value: value, child: Text(value.isEmpty ? '默认' : value))).toList(),
          onChanged: (value) => state.updatePrefs(prefs.copyWith(model: value ?? '')),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: prefs.reasoningEffort,
                decoration: const InputDecoration(labelText: '思考等级', isDense: true),
                items: const ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
                    .map((value) => DropdownMenuItem(value: value, child: Text(_reasoningLabel(value))))
                    .toList(),
                onChanged: (value) => state.updatePrefs(prefs.copyWith(reasoningEffort: value ?? 'medium')),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: _presetValue(prefs),
                decoration: const InputDecoration(labelText: '权限预设', isDense: true),
                items: const [
                  DropdownMenuItem(value: 'auto', child: Text('Default')),
                  DropdownMenuItem(value: 'read-only', child: Text('Read Only')),
                  DropdownMenuItem(value: 'full-access', child: Text('Full Access')),
                ],
                onChanged: (value) => state.applyPermissionPreset(value ?? 'auto'),
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
                decoration: const InputDecoration(labelText: '主题', isDense: true),
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
                label: Text(_workspaceLabel(state.workspacePath), overflow: TextOverflow.ellipsis),
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

Future<void> showSettingsSheet(BuildContext context, CodexAppState state) async {
  final server = TextEditingController(text: state.serverUrl);
  final token = TextEditingController(text: state.token);
  unawaited(state.loadAuthSessions());
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => AnimatedBuilder(
      animation: state,
      builder: (context, _) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, bottom: MediaQuery.viewInsetsOf(context).bottom + 16),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.82),
          child: ListView(
            shrinkWrap: true,
            children: [
              Text('连接设置', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              TextField(controller: server, decoration: const InputDecoration(labelText: '服务地址', border: OutlineInputBorder())),
              const SizedBox(height: 12),
              TextField(controller: token, obscureText: true, decoration: const InputDecoration(labelText: 'Token', border: OutlineInputBorder())),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: OutlinedButton(onPressed: state.refreshHealth, child: const Text('检查服务'))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: () async {
                        state.updateServerDraft(server.text);
                        state.updateTokenDraft(token.text);
                        await state.login();
                        if (context.mounted) Navigator.pop(context);
                      },
                      child: const Text('保存并登录'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(child: Text('在线连接', style: Theme.of(context).textTheme.titleMedium)),
                  TextButton.icon(
                    onPressed: state.authSessionsLoading ? null : state.loadAuthSessions,
                    icon: state.authSessionsLoading
                        ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
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
                ...state.authSessions.map((session) => ListTile(
                      dense: true,
                      leading: Icon(session.current ? Icons.phone_android : Icons.devices_other_outlined),
                      title: Text(session.deviceName, maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(session.current ? '当前设备' : '最近活动 ${_formatDateTime(session.lastSeenAt)}'),
                      trailing: session.online ? const Icon(Icons.circle, size: 10, color: Colors.green) : null,
                    )),
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
    ),
  );
  server.dispose();
  token.dispose();
}

Future<void> showNewSessionSheet(BuildContext context, CodexAppState state) async {
  final name = TextEditingController(text: '新会话');
  final cwd = TextEditingController(text: state.workspacePath);
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(left: 16, right: 16, bottom: MediaQuery.viewInsetsOf(context).bottom + 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('新建会话', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(controller: name, decoration: const InputDecoration(labelText: '名称', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: cwd, decoration: const InputDecoration(labelText: '工作区路径', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => showWorkspaceSheet(context, state, onPick: (path) => cwd.text = path),
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
                    state.createSession(name: name.text, cwd: cwd.text);
                    Navigator.pop(context);
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
  name.dispose();
  cwd.dispose();
}

Future<void> showWorkspaceSheet(BuildContext context, CodexAppState state, {ValueChanged<String>? onPick}) async {
  final folder = TextEditingController();
  await state.loadWorkspace(state.workspacePath);
  if (!context.mounted) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => AnimatedBuilder(
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
                    Expanded(child: Text(listing?.path ?? state.workspacePath, maxLines: 1, overflow: TextOverflow.ellipsis)),
                    IconButton(icon: const Icon(Icons.check), onPressed: () {
                      final path = listing?.path ?? state.workspacePath;
                      onPick?.call(path);
                      state.workspacePath = path;
                      Navigator.pop(context);
                    }),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
                child: Row(
                  children: [
                    Expanded(child: TextField(controller: folder, decoration: const InputDecoration(labelText: '新文件夹', isDense: true))),
                    IconButton(icon: const Icon(Icons.create_new_folder_outlined), onPressed: () => state.createWorkspaceFolder(folder.text)),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  children: [
                    if ((listing?.parentPath ?? '').isNotEmpty)
                      ListTile(leading: const Icon(Icons.arrow_upward), title: const Text('上一级'), onTap: () => state.loadWorkspace(listing!.parentPath)),
                    ...?listing?.entries.map((entry) => ListTile(
                          leading: const Icon(Icons.folder_outlined),
                          title: Text(entry.name),
                          subtitle: Text(entry.path, maxLines: 1, overflow: TextOverflow.ellipsis),
                          onTap: () => state.loadWorkspace(entry.path),
                        )),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    ),
  );
  folder.dispose();
}

Future<void> showApprovalsSheet(BuildContext context, CodexAppState state) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final pending = state.approvals.where((item) => item.threadId.isEmpty || item.threadId == state.activeSessionId).toList(growable: false);
        return SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              Text('待处理审批', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              ...pending.map((request) => ApprovalCard(state: state, request: request)),
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
  final TextEditingController _json = TextEditingController(text: '[{"type":"inputText","text":"ok"}]');
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
            Text(request.displayTitle, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            SelectableText(request.displayBody),
            if (request.cwd.isNotEmpty) Text(request.cwd, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 12),
            ...special,
            if (special.isEmpty)
              Wrap(
                spacing: 8,
                children: (request.availableDecisions.isNotEmpty ? request.availableDecisions : const ['accept', 'decline']).map((decision) {
                  final index = (request.availableDecisions.isNotEmpty ? request.availableDecisions : const ['accept', 'decline']).indexOf(decision);
                  final onPressed = request.status == 'submitting' ? null : () => widget.state.respondApproval(request, _decisionResponse(decision));
                  return index == 0
                      ? FilledButton(onPressed: onPressed, child: Text(_decisionLabel(decision)))
                      : OutlinedButton(onPressed: onPressed, child: Text(_decisionLabel(decision)));
                }).toList(growable: false),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _specialForm(BuildContext context, ServerRequestItem request) {
    if (request.method == 'item/tool/requestUserInput' || request.questions.isNotEmpty) {
      return [
        ...request.questions.map((question) {
          final id = readString(question, 'id', readString(question, 'header'));
          final controller = _answers.putIfAbsent(id, TextEditingController.new);
          final options = question['options'] is List ? (question['options'] as List).whereType<JsonMap>().toList(growable: false) : const <JsonMap>[];
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(readString(question, 'header', readString(question, 'question', id)), style: Theme.of(context).textTheme.labelLarge),
                if (options.isNotEmpty)
                  ...options.map((option) {
                    final label = readString(option, 'label');
                    final checked = controller.text == label;
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(checked ? Icons.radio_button_checked : Icons.radio_button_unchecked),
                      title: Text(label),
                      subtitle: readString(option, 'description').isEmpty ? null : Text(readString(option, 'description')),
                      onTap: () => setState(() => controller.text = label),
                    );
                  }),
                if (options.isEmpty || question['isOther'] == true || question['isSecret'] == true)
                  TextField(
                    controller: controller,
                    obscureText: question['isSecret'] == true,
                    decoration: InputDecoration(labelText: readString(question, 'question', id), border: const OutlineInputBorder()),
                  ),
              ],
            ),
          );
        }),
        FilledButton(
          onPressed: () {
            widget.state.respondApproval(request, {
              'answers': _answers.map((key, value) => MapEntry(key, {'answers': [value.text]})),
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
          decoration: const InputDecoration(labelText: 'contentItems JSON', border: OutlineInputBorder()),
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
              contentItems = _json.text.trim().isEmpty ? [] : jsonDecode(_json.text);
              if (contentItems is! List) {
                throw const FormatException('contentItems 必须是数组');
              }
            } catch (_) {
              widget.state.respondApproval(request, {'error': 'contentItems JSON 无效'});
              return;
            }
            widget.state.respondApproval(request, {'contentItems': contentItems, 'success': _toolSuccess});
          },
          child: const Text('提交结果'),
        ),
      ];
    }
    if (request.method == 'mcpServer/elicitation/request') {
      if (request.mode == 'url') {
        return [
          FilledButton(onPressed: () => widget.state.respondApproval(request, {'action': 'accept', 'content': null, '_meta': request.raw['meta']}), child: const Text('允许')),
          OutlinedButton(onPressed: () => widget.state.respondApproval(request, {'action': 'decline', 'content': null}), child: const Text('拒绝')),
        ];
      }
      final schema = request.requestedSchema.isNotEmpty ? request.requestedSchema : request.responseSchema;
      final properties = schema['properties'];
      final fields = properties is JsonMap ? properties : const <String, dynamic>{};
      return [
        ...fields.entries.map((entry) {
          final controller = _answers.putIfAbsent(entry.key, TextEditingController.new);
          final fieldSpec = entry.value is JsonMap ? entry.value as JsonMap : const <String, dynamic>{};
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: TextField(
              controller: controller,
              keyboardType: _keyboardForSchema(fieldSpec),
              decoration: InputDecoration(labelText: readString(fieldSpec, 'title', entry.key), border: const OutlineInputBorder()),
            ),
          );
        }),
        Wrap(
          spacing: 8,
          children: [
            FilledButton(
              onPressed: () => widget.state.respondApproval(request, {
                'action': 'accept',
                'content': fields.map((key, spec) => MapEntry(key, _normalizeSchemaValue(_answers[key]?.text ?? '', spec is JsonMap ? spec : const <String, dynamic>{}))),
                '_meta': request.raw['meta'],
              }),
              child: const Text('提交'),
            ),
            OutlinedButton(onPressed: () => widget.state.respondApproval(request, {'action': 'decline', 'content': null}), child: const Text('拒绝')),
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
              leading: Icon(state.notices[i]['level'] == 'error' ? Icons.error_outline : Icons.info_outline),
              title: Text('${state.notices[i]['title'] ?? '通知'}'),
              subtitle: Text('${state.notices[i]['message'] ?? ''}'),
              trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => state.dismissNotice(i)),
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
  {'command': 'goal', 'args': '[objective]', 'aliases': '', 'description': 'set or view the goal'},
  {'command': 'compact', 'args': '', 'aliases': '', 'description': 'summarize conversation'},
  {'command': 'rename', 'args': '<name>', 'aliases': '', 'description': 'rename thread'},
  {'command': 'stop', 'args': '', 'aliases': 'clean', 'description': 'stop background terminals'},
  {'command': 'review', 'args': '', 'aliases': '', 'description': 'review current changes'},
  {'command': 'plan', 'args': '', 'aliases': '', 'description': 'switch to Plan mode'},
  {'command': 'diff', 'args': '', 'aliases': '', 'description': 'show git diff'},
  {'command': 'status', 'args': '', 'aliases': '', 'description': 'show status'},
  {'command': 'model', 'args': '', 'aliases': '', 'description': 'choose model'},
  {'command': 'permissions', 'args': '', 'aliases': '', 'description': 'choose permissions'},
  {'command': 'new', 'args': '', 'aliases': '', 'description': 'start a new chat'},
  {'command': 'resume', 'args': '', 'aliases': '', 'description': 'resume chat'},
  {'command': 'fork', 'args': '', 'aliases': '', 'description': 'fork chat'},
  {'command': 'init', 'args': '', 'aliases': '', 'description': 'create AGENTS.md'},
  {'command': 'copy', 'args': '', 'aliases': '', 'description': 'copy last response'},
  {'command': 'mention', 'args': '', 'aliases': '', 'description': 'mention a file'},
  {'command': 'skills', 'args': '', 'aliases': '', 'description': 'use skills'},
  {'command': 'mcp', 'args': '', 'aliases': '', 'description': 'list MCP tools'},
  {'command': 'apps', 'args': '', 'aliases': '', 'description': 'manage apps'},
  {'command': 'plugins', 'args': '', 'aliases': '', 'description': 'browse plugins'},
  {'command': 'logout', 'args': '', 'aliases': '', 'description': 'log out'},
  {'command': 'quit', 'args': '', 'aliases': 'exit', 'description': 'exit Codex'},
];

String? _slashQuery(String value) {
  if (!value.startsWith('/') || value.contains('\n') || value.contains(' ')) {
    return null;
  }
  return value.substring(1).toLowerCase();
}

String _changeStats(JsonMap change) {
  final added = _num(change['addedLines']) ?? _num(change['added_lines']) ?? 0;
  final deleted = _num(change['deletedLines']) ?? _num(change['deleted_lines']) ?? 0;
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
  final dt = DateTime.fromMillisecondsSinceEpoch(timestamp < 100000000000 ? timestamp * 1000 : timestamp);
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
  final parts = trimmed.split(RegExp(r'[\\/]')).where((item) => item.isNotEmpty).toList();
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
  if (prefs.approvalPolicy == 'never' && prefs.sandboxMode == 'danger-full-access') return 'full-access';
  if (prefs.sandboxMode == 'read-only') return 'read-only';
  return 'auto';
}

UsageDisplay _usageDisplay(JsonMap? value) {
  if (value == null) {
    return const UsageDisplay(label: '上下文', detail: '未统计', shortLabel: '--');
  }
  final nested = value['usage'] is JsonMap ? value['usage'] as JsonMap : value;
  final window = _num(nested['modelContextWindow'] ?? nested['model_context_window']);
  final last = nested['last'] is JsonMap ? nested['last'] as JsonMap : const <String, dynamic>{};
  final total = _num(last['totalTokens'] ?? last['total_tokens'] ?? nested['totalTokens'] ?? nested['total_tokens']);
  if (window != null && window > 0 && total != null) {
    final used = ((total / window) * 100).round().clamp(0, 100);
    final remaining = 100 - used;
    return UsageDisplay(
      label: '上下文余量',
      detail: '剩余 $remaining% · ${max(window - total, 0).round()} / ${window.round()} tokens',
      percentRemaining: remaining,
      shortLabel: '$remaining%',
    );
  }
  if (total != null) {
    return UsageDisplay(label: '总量', detail: '总 ${total.round()}', shortLabel: '${total.round()}');
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
