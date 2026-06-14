import 'package:codex_remote_mobile/src/app_state.dart';
import 'package:codex_remote_mobile/src/models.dart';
import 'package:codex_remote_mobile/src/native_bridge.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('merges streaming timeline events like web', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-1';

    state.handleServerMessage({
      'type': 'agent_delta',
      'threadId': threadId,
      'turnId': 'turn-1',
      'itemId': 'agent-item-1',
      'delta': 'Hel',
    });
    state.handleServerMessage({
      'type': 'agent_delta',
      'threadId': threadId,
      'turnId': 'turn-1',
      'itemId': 'agent-item-1',
      'delta': 'lo',
    });
    state.handleServerMessage({
      'type': 'item_completed',
      'threadId': threadId,
      'turnId': 'turn-1',
      'item': {'id': 'agent-item-1', 'type': 'agentMessage', 'text': 'Hello'},
    });

    final assistantEntries = state.timelineByThread[threadId]!
        .where((item) => item.role == 'assistant' && item.type == 'message')
        .toList();
    expect(assistantEntries, hasLength(1));
    expect(assistantEntries.single.id, 'agent-item-1');
    expect(assistantEntries.single.text, 'Hello');

    state.handleServerMessage({
      'type': 'item_started',
      'threadId': threadId,
      'turnId': 'turn-2',
      'item': {
        'id': 'cmd-1',
        'type': 'commandExecution',
        'command': 'npm test',
        'cwd': r'C:\repo',
      },
    });
    state.handleServerMessage({
      'type': 'item_delta',
      'threadId': threadId,
      'turnId': 'turn-2',
      'itemId': 'cmd-1',
      'method': 'item/commandExecution/outputDelta',
      'delta': 'ok',
    });
    state.handleServerMessage({
      'type': 'item_completed',
      'threadId': threadId,
      'turnId': 'turn-2',
      'item': {
        'id': 'cmd-1',
        'type': 'commandExecution',
        'command': 'npm test',
        'cwd': r'C:\repo',
        'output': 'ok',
        'exitCode': 0,
        'status': 'completed',
      },
    });

    final commandEntries = state.timelineByThread[threadId]!
        .where((item) => item.type == 'command' && item.itemId == 'cmd-1')
        .toList();
    expect(commandEntries, hasLength(1));
    expect(commandEntries.single.meta, isNot(contains('退出码 0')));
    expect(
      readString(commandEntries.single.details ?? const {}, 'output'),
      'ok',
    );

    state.handleServerMessage({
      'type': 'item_completed',
      'threadId': threadId,
      'turnId': 'turn-3',
      'item': {
        'id': 'file-1',
        'type': 'fileChange',
        'changes': [
          {'path': 'lib/main.dart', 'kind': 'update'},
        ],
      },
    });
    state.handleServerMessage({
      'type': 'turn_diff_updated',
      'threadId': threadId,
      'turnId': 'turn-3',
      'diff': '*** Update File: lib/main.dart\n+ok',
    });

    final fileEntry = state.timelineByThread[threadId]!.singleWhere(
      (item) => item.type == 'file_change' && item.turnId == 'turn-3',
    );
    expect(fileEntry.patch, contains('lib/main.dart'));
    expect(
      state.timelineByThread[threadId]!.any(
        (item) => item.type == 'turn_diff' && item.turnId == 'turn-3',
      ),
      isFalse,
    );

    state.dispose();
  });

  test('dedupes optimistic user message after thread sync', () async {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-1';
    state.activeSessionId = threadId;

    await state.sendPrompt('Hello **Codex**');
    state.handleServerMessage({
      'type': 'turn_started',
      'threadId': threadId,
      'turnId': 'turn-user',
      'startedAt': 1000,
    });
    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-user',
          'startedAt': 1000,
          'items': [
            {
              'id': 'server-user-1',
              'type': 'userMessage',
              'text': 'Hello **Codex**',
              'createdAt': 1001,
            },
          ],
        },
      ],
    });

    final userEntries = state.timelineByThread[threadId]!
        .where((item) => item.role == 'user' && item.text == 'Hello **Codex**')
        .toList();
    expect(userEntries, hasLength(1));
    expect(userEntries.single.id, isNot(startsWith('local-user:')));
    state.dispose();
  });

  test('filters non-rendered thread sync timeline events like web', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-1';

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [],
      'timelineEvents': [
        {
          'type': 'thread_event',
          'threadId': threadId,
          'method': 'thread/goal/cleared',
          'turnId': 'turn-1',
        },
        {
          'type': 'notification',
          'threadId': threadId,
          'method': 'skills/changed',
        },
        {
          'type': 'warning',
          'threadId': threadId,
          'noticeId': 'warn-1',
          'message': 'warning',
        },
      ],
    });

    expect(state.timelineByThread[threadId], isEmpty);
    state.dispose();
  });

  test('replays thread sync events that inherit outer thread id', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-1';

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [],
      'timelineEvents': [
        {
          'type': 'item_completed',
          'turnId': 'turn-1',
          'item': {
            'id': 'assistant-1',
            'type': 'agentMessage',
            'text': 'Restored message',
          },
        },
      ],
    });

    final entries = state.timelineByThread[threadId] ?? const [];
    expect(entries.where((item) => item.role == 'assistant'), hasLength(1));
    expect(entries.single.text, 'Restored message');
    state.dispose();
  });
}

class _TestBridge extends NativeBridge {
  final Map<String, String> values = {};

  @override
  Future<String?> getString(String key) async => values[key];

  @override
  Future<void> setString(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }

  @override
  Future<PickedImage?> pickImage() async => null;
}
