import 'dart:convert';

import 'package:codex_remote_mobile/src/models.dart';

void main() {
  final session = SessionItem.fromJson({
    'threadId': 'thread-1',
    'name': 'Mobile',
    'cwd': r'C:\repo',
    'model': 'gpt-5-codex',
    'reasoningEffort': 'high',
    'approvalPolicy': 'on-request',
    'sandboxMode': 'workspace-write',
    'tokenUsage': {
      'usage': {
        'modelContextWindow': 1000,
        'last': {'totalTokens': 250},
      },
    },
  });
  _expect(session.threadId == 'thread-1', 'session thread id');
  _expect(session.tokenUsage != null, 'session token usage');

  final authSession = AuthSessionItem.fromJson({
    'sessionId': 'device-1',
    'deviceName': 'Android App',
    'createdAt': 1,
    'lastSeenAt': 2,
    'expiresAt': 3,
    'current': true,
    'online': true,
  });
  _expect(authSession.current && authSession.online, 'auth session flags');

  final request = ServerRequestItem({
    'requestId': 'approval-1',
    'method': 'item/tool/requestUserInput',
    'threadId': 'thread-1',
    'questions': [
      {
        'id': 'choice',
        'header': 'Mode',
        'options': [
          {'label': 'Default', 'description': 'Use defaults'},
        ],
      },
    ],
    'availableDecisions': ['accept', 'decline'],
  });
  _expect(request.questions.length == 1, 'approval questions');
  _expect(request.availableDecisions.length == 2, 'approval decisions');

  final decoded = jsonDecode('{"entries":[{"name":"repo","path":"C:/repo"}]}');
  final listing = WorkspaceListing.fromJson(decoded as JsonMap);
  _expect(listing.entries.single.name == 'repo', 'workspace listing');

  final entry = TimelineEntry(
    id: 'item-1',
    type: 'file_change',
    title: '文件变更',
    role: 'system',
    patch: '*** Update File: app.dart',
    changes: [
      {'path': 'app.dart', 'addedLines': 1},
    ],
    attachments: [
      AttachmentItem(
        id: 'upload.png',
        name: 'upload.png',
        contentType: 'image/png',
        filePath: r'C:\repo\upload.png',
        url: '/api/uploads/upload.png',
      ),
    ],
  ).copyWith(status: 'completed', partial: false);
  _expect(
    entry.changes.single['path'] == 'app.dart',
    'timeline changes preserved',
  );
  _expect(
    entry.attachments.single.url == '/api/uploads/upload.png',
    'timeline attachments preserved',
  );
}

void _expect(bool condition, String label) {
  if (!condition) {
    throw StateError('Smoke check failed: $label');
  }
}
