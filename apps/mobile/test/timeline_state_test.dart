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
