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

  test('restores v2 user and assistant items into the active timeline', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-v2';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-v2',
          'status': 'completed',
          'startedAt': 1700000000,
          'completedAt': 1700000001,
          'items': [
            {
              'id': 'user-v2',
              'type': 'userMessage',
              'content': [
                {'type': 'text', 'text': '用户问题'},
                {
                  'type': 'localImage',
                  'path': r'C:\repo\.codex-remote-uploads\1700-shot.png',
                },
              ],
            },
            {'id': 'assistant-v2', 'type': 'agentMessage', 'text': '助手回复'},
          ],
        },
      ],
    });

    final messages = state.activeTimeline
        .where((entry) => entry.type == 'message')
        .toList(growable: false);
    final userEntries = messages.where((entry) => entry.role == 'user');
    final assistantEntries = messages.where(
      (entry) => entry.role == 'assistant',
    );

    expect(userEntries, hasLength(1));
    expect(userEntries.single.id, 'user-v2');
    expect(userEntries.single.text, '用户问题');
    expect(userEntries.single.attachments, hasLength(1));
    expect(
      userEntries.single.attachments.single.url,
      contains('/api/uploads/'),
    );
    expect(
      userEntries.single.attachments.single.url,
      endsWith('1700-shot.png'),
    );
    expect(assistantEntries, hasLength(1));
    expect(assistantEntries.single.id, 'assistant-v2');
    expect(assistantEntries.single.text, '助手回复');
    state.dispose();
  });

  test('restores generic structured message items like web', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-generic-message';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-generic-message',
          'status': 'completed',
          'items': [
            {
              'id': 'generic-user',
              'type': 'message',
              'role': 'user',
              'content': [
                {'type': 'input_text', 'text': '通用用户消息'},
              ],
            },
            {
              'id': 'generic-assistant',
              'type': 'message',
              'role': 'assistant',
              'content': [
                {'type': 'output_text', 'text': '通用助手回复'},
              ],
            },
          ],
        },
      ],
    });

    final entries = state.activeTimeline;
    expect(
      entries.any(
        (entry) => entry.id == 'generic-user' && entry.text == '通用用户消息',
      ),
      isTrue,
    );
    expect(
      entries.any(
        (entry) => entry.id == 'generic-assistant' && entry.text == '通用助手回复',
      ),
      isTrue,
    );
    state.dispose();
  });

  test(
    'restores turn-level structured input and output when items omit messages',
    () {
      final state = CodexAppState(_TestBridge());
      const threadId = 'thread-turn-structured';
      state.activeSessionId = threadId;

      state.handleServerMessage({
        'type': 'thread_sync',
        'threadId': threadId,
        'turns': [
          {
            'id': 'turn-structured',
            'status': 'completed',
            'input': [
              {'type': 'input_text', 'text': '用户提问'},
            ],
            'output': [
              {'type': 'output_text', 'text': '结构化输出回复'},
            ],
            'items': [
              {
                'id': 'cmd-structured',
                'type': 'commandExecution',
                'command': 'npm test',
                'status': 'completed',
              },
            ],
          },
        ],
      });

      final entries = state.activeTimeline;
      expect(
        entries.any((entry) => entry.role == 'user' && entry.text == '用户提问'),
        isTrue,
      );
      expect(
        entries.any(
          (entry) => entry.role == 'assistant' && entry.text == '结构化输出回复',
        ),
        isTrue,
      );
      expect(
        entries.any(
          (entry) => entry.type == 'command' && entry.text == 'npm test',
        ),
        isTrue,
      );
      state.dispose();
    },
  );

  test('does not render empty message item ids as message text', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-empty-message';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-empty-message',
          'status': 'completed',
          'items': [
            {'id': 'assistant-empty', 'type': 'agentMessage'},
          ],
        },
      ],
    });

    expect(
      state.activeTimeline.any((entry) => entry.text == 'assistant-empty'),
      isFalse,
    );
    expect(
      state.activeTimeline.where((entry) => entry.role == 'assistant'),
      isEmpty,
    );
    state.dispose();
  });

  test('restores file change patch text from structured output fields', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-structured-file';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-structured-file',
          'status': 'completed',
          'items': [
            {
              'id': 'file-structured',
              'type': 'fileChange',
              'status': 'completed',
              'output': [
                {
                  'type': 'output_text',
                  'text':
                      '*** Begin Patch\n*** Update File: src/a.ts\n+ok\n*** End Patch',
                },
              ],
              'changes': [
                {'path': 'src/a.ts', 'kind': 'update'},
              ],
            },
          ],
        },
      ],
    });

    final fileEntry = state.activeTimeline.singleWhere(
      (entry) => entry.id == 'file-structured',
    );
    expect(fileEntry.patch, contains('src/a.ts'));
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
