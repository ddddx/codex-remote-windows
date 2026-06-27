import 'package:codex_remote_mobile/main.dart';
import 'package:codex_remote_mobile/src/app_state.dart';
import 'package:codex_remote_mobile/src/models.dart';
import 'package:codex_remote_mobile/src/native_bridge.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders turn plans and expandable file diffs', (tester) async {
    final state = CodexAppState(_TestBridge())
      ..cookie = 'cookie'
      ..serverUrl = 'http://192.168.2.15:18637'
      ..token = 'token'
      ..connectionStatus = 'connected'
      ..activeSessionId = 'thread-1'
      ..sessions = [SessionItem(threadId: 'thread-1', name: '测试会话')];
    addTearDown(state.dispose);

    state.timelineByThread['thread-1'] = [
      TimelineEntry(
        id: 'turn-plan:turn-1',
        type: 'turn_plan',
        title: '执行计划',
        role: 'assistant',
        turnId: 'turn-1',
        meta: const ['进行中 · 收集信息'],
        createdAt: 1,
      ),
      TimelineEntry(
        id: 'file-change-1',
        type: 'file_change',
        title: '文件变更',
        role: 'system',
        turnId: 'turn-1',
        changes: const [
          {
            'path': 'lib/main.dart',
            'kind': 'update',
            'diff': '@@ -1,1 +1,1 @@\n-old line\n+new line',
          },
        ],
        createdAt: 2,
      ),
    ];

    await tester.pumpWidget(MaterialApp(home: AppShell(state: state)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('执行计划'), findsOneWidget);
    expect(find.textContaining('收集信息'), findsOneWidget);
    expect(find.textContaining('main.dart'), findsOneWidget);

    await tester.tap(find.textContaining('main.dart').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.textContaining('lib/main.dart'), findsOneWidget);
    expect(find.textContaining('@@ -1,1 +1,1 @@'), findsOneWidget);
    expect(find.textContaining('+new line'), findsOneWidget);
  });
}

class _TestBridge extends NativeBridge {}
