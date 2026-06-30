import 'dart:async';
import 'dart:ffi';

import 'package:codex_remote_mobile/src/app_state.dart';
import 'package:codex_remote_mobile/src/models.dart';
import 'package:codex_remote_mobile/src/native_bridge.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('extracts and compares GitHub mobile release versions', () {
    expect(
      extractVersionNameFromRelease(
        assetName: 'codex-remote-v1.0.11-universal-sdk35-release.apk',
        tagName: 'mobile-build-v1.0.11-1-abcdef',
        releaseName: 'Codex Remote Android v1.0.11',
      ),
      '1.0.11',
    );
    expect(compareVersionNames('1.0.12', '1.0.11'), greaterThan(0));
    expect(compareVersionNames('1.0.11', '1.0.11'), 0);
    expect(compareVersionNames('1.0.9', '1.0.11'), lessThan(0));
  });

  test('extracts mobile release info from GitHub html fallback', () {
    final info = extractMobileUpdateInfoFromReleaseHtml(
      currentAbi: Abi.androidArm64,
      finalUrl:
          'https://github.com/ddddx/codex-remote-windows/releases/tag/mobile-build-v1.0.15-1-abcdef',
      html: '''
        <html>
          <head><title>Codex Remote Android v1.0.15 · Release</title></head>
          <body>
            <a href="/ddddx/codex-remote-windows/releases/download/mobile-build-v1.0.15-1-abcdef/codex-remote-v1.0.15-arm64-v8a-sdk35-release.apk">arm64</a>
            <a href="/ddddx/codex-remote-windows/releases/download/mobile-build-v1.0.15-1-abcdef/codex-remote-v1.0.15-universal-sdk35-release.apk?download=1&amp;x=2">universal</a>
          </body>
        </html>
      ''',
    );

    expect(info, isNotNull);
    expect(info!.versionName, '1.0.15');
    expect(info.tagName, 'mobile-build-v1.0.15-1-abcdef');
    expect(info.apkName, 'codex-remote-v1.0.15-arm64-v8a-sdk35-release.apk');
    expect(info.apkUrl, contains('https://github.com/'));
    expect(info.apkUrl, contains('arm64-v8a'));
  });

  test('extracts GitHub expanded assets URL from lazy release page', () {
    final url = extractGithubExpandedAssetsUrl(
      finalUrl:
          'https://github.com/ddddx/codex-remote-windows/releases/tag/mobile-build-v1.0.18-7-abcdef',
      html: '''
        <include-fragment
          src="https://github.com/ddddx/codex-remote-windows/releases/expanded_assets/mobile-build-v1.0.18-7-abcdef">
        </include-fragment>
      ''',
    );

    expect(
      url,
      'https://github.com/ddddx/codex-remote-windows/releases/expanded_assets/mobile-build-v1.0.18-7-abcdef',
    );
    expect(
      extractGithubExpandedAssetsUrl(
        html: '<html></html>',
        finalUrl:
            'https://github.com/ddddx/codex-remote-windows/releases/tag/mobile-build-v1.0.18-7-abcdef',
      ),
      url,
    );
  });

  test(
    'selects release apk by current Android ABI before universal fallback',
    () {
      const assets = [
        'codex-remote-v1.0.15-universal-sdk35-release.apk',
        'codex-remote-v1.0.15-arm64-v8a-sdk35-release.apk',
        'codex-remote-v1.0.15-armeabi-v7a-sdk35-release.apk',
        'codex-remote-v1.0.15-x86_64-sdk35-release.apk',
      ];

      expect(
        selectBestMobileApkAssetName(assets, currentAbi: Abi.androidArm64),
        'codex-remote-v1.0.15-arm64-v8a-sdk35-release.apk',
      );
      expect(
        selectBestMobileApkAssetName(assets, currentAbi: Abi.androidArm),
        'codex-remote-v1.0.15-armeabi-v7a-sdk35-release.apk',
      );
      expect(
        selectBestMobileApkAssetName(assets, currentAbi: Abi.androidX64),
        'codex-remote-v1.0.15-x86_64-sdk35-release.apk',
      );
      expect(
        selectBestMobileApkAssetName(const [
          'codex-remote-v1.0.15-universal-sdk35-release.apk',
        ], currentAbi: Abi.androidArm64),
        'codex-remote-v1.0.15-universal-sdk35-release.apk',
      );
    },
  );

  test('normalizes and persists update download thread count', () {
    final bridge = _TestBridge();
    final state = CodexAppState(bridge);
    addTearDown(state.dispose);

    expect(normalizeUpdateDownloadConnectionLimit(null), 4);
    expect(normalizeUpdateDownloadConnectionLimit(0), 1);
    expect(normalizeUpdateDownloadConnectionLimit(32), 32);
    expect(normalizeUpdateDownloadConnectionLimit(99), 64);

    state.setUpdateDownloadConnectionLimit(32);

    expect(state.updateDownloadConnectionLimit, 32);
    expect(bridge.values['updateDownloadConnectionLimit'], '32');
  });

  test('downloads update before opening installer', () async {
    final bridge = _TestBridge()
      ..downloadedApk = const DownloadedApk(
        fileName: 'codex-remote-v1.0.18-arm64-v8a-sdk35-release.apk',
        sizeBytes: 42,
      );
    final state = CodexAppState(bridge)
      ..availableUpdate = const MobileUpdateInfo(
        versionName: '1.0.18',
        tagName: 'mobile-build-v1.0.18',
        releaseUrl: 'https://github.com/ddddx/codex-remote-windows/releases',
        apkName: 'codex-remote-v1.0.18-arm64-v8a-sdk35-release.apk',
        apkUrl: 'https://github.com/release.apk',
      );
    addTearDown(state.dispose);

    state.setUpdateDownloadConnectionLimit(6);
    await state.downloadAvailableUpdate();

    expect(bridge.downloadedUrls, ['https://github.com/release.apk']);
    expect(bridge.downloadedMaxConnections, [6]);
    expect(state.updateReadyToInstall, isTrue);
    expect(state.updateDownloadedApkName, contains('arm64-v8a'));
    expect(bridge.installedApks, isEmpty);

    await state.installDownloadedUpdate();

    expect(bridge.installedApks, [
      'codex-remote-v1.0.18-arm64-v8a-sdk35-release.apk',
    ]);
  });

  test('clears update progress after cancelled download', () async {
    final bridge = _TestBridge()
      ..downloadError = PlatformException(
        code: 'download_cancelled',
        message: '下载已取消',
      );
    final state = CodexAppState(bridge)
      ..availableUpdate = const MobileUpdateInfo(
        versionName: '1.0.18',
        tagName: 'mobile-build-v1.0.18',
        releaseUrl: 'https://github.com/ddddx/codex-remote-windows/releases',
        apkName: 'codex-remote-v1.0.18-arm64-v8a-sdk35-release.apk',
        apkUrl: 'https://github.com/release.apk',
      );
    addTearDown(state.dispose);

    await state.downloadAvailableUpdate();

    expect(state.updateDownloading, isFalse);
    expect(state.updateReadyToInstall, isFalse);
    expect(state.hasUpdateDownloadProgress, isFalse);
    expect(state.updateMessage, '下载已取消');
  });

  test('tracks update download progress and speed', () async {
    final bridge = _TestBridge();
    final state = CodexAppState(bridge);
    addTearDown(state.dispose);

    bridge.emitDownloadProgress(
      const UpdateDownloadProgress(
        status: 'downloading',
        url: 'https://github.com/release.apk',
        fileName: 'release.apk',
        downloadedBytes: 1024 * 1024,
        totalBytes: 4 * 1024 * 1024,
        bytesPerSecond: 512 * 1024,
        progress: 0.25,
        accelerated: true,
        connections: 4,
        message: '',
      ),
    );
    await Future<void>.delayed(Duration.zero);

    expect(state.updateMessage, '正在下载...');
    expect(state.updateDownloadProgress, 0.25);
    expect(state.updateDownloadDetail, contains('25%'));
    expect(state.updateDownloadDetail, contains('1.0 MB / 4.0 MB'));
    expect(state.updateDownloadDetail, contains('512 KB/s'));
    expect(state.updateDownloadDetail, contains('分段 x4'));
  });

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

  test('thread sync replays assistant deltas into one live message', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-live-deltas';

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'timelineEvents': [
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-live-deltas',
          'itemId': 'assistant-live-deltas',
          'delta': 'hello ',
          'startedAt': 1,
          'sequence': 1,
        },
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-live-deltas',
          'itemId': 'assistant-live-deltas',
          'delta': 'world',
          'startedAt': 2,
          'sequence': 2,
        },
      ],
    });

    final assistant = state.timelineByThread[threadId]!.singleWhere(
      (entry) => entry.id == 'assistant-live-deltas',
    );
    expect(assistant.text, 'hello world');
    expect(assistant.partial, isTrue);
    state.dispose();
  });

  test('thread sync replaces stale partial assistant text while replaying', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-stale-live-deltas';

    state.handleServerMessage({
      'type': 'agent_delta',
      'threadId': threadId,
      'turnId': 'turn-stale-live-deltas',
      'itemId': 'assistant-stale-live-deltas',
      'delta': 'hello ',
    });
    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'timelineEvents': [
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-stale-live-deltas',
          'itemId': 'assistant-stale-live-deltas',
          'delta': 'hello ',
          'startedAt': 1,
          'sequence': 1,
        },
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-stale-live-deltas',
          'itemId': 'assistant-stale-live-deltas',
          'delta': 'world',
          'startedAt': 2,
          'sequence': 2,
        },
      ],
    });

    final assistant = state.timelineByThread[threadId]!.singleWhere(
      (entry) => entry.id == 'assistant-stale-live-deltas',
    );
    expect(assistant.text, 'hello world');
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

  test(
    'auth failure clears stale cookie instead of staying connected',
    () async {
      final bridge = _TestBridge();
      final state = CodexAppState(bridge)
        ..cookie = 'stale-cookie'
        ..connectionStatus = 'connected';
      bridge.values['cookie'] = 'stale-cookie';

      state.handleServerMessage({
        'type': 'error',
        'code': 'AUTH_FAILED',
        'message': 'WebSocket 鉴权失败，请先重新登录。',
      });
      await Future<void>.delayed(Duration.zero);

      expect(state.cookie, isEmpty);
      expect(state.connectionStatus, 'idle');
      expect(bridge.values.containsKey('cookie'), isFalse);
      expect(state.errorMessage, contains('鉴权失败'));
      state.dispose();
    },
  );

  test(
    'android setup rejects loopback server urls with stale cookies',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      final bridge = _TestBridge()
        ..values['serverUrl'] = 'http://127.0.0.1:18637'
        ..values['token'] = 'token'
        ..values['cookie'] = 'stale-cookie';
      final state = CodexAppState(bridge);
      addTearDown(() {
        debugDefaultTargetPlatformOverride = null;
        state.dispose();
      });

      await state.initialize();

      expect(state.requiresSetup, isTrue);
      expect(state.cookie, isEmpty);
      expect(bridge.values.containsKey('cookie'), isFalse);
      expect(state.errorMessage, contains('不能使用 127.0.0.1'));
    },
  );

  test('login validates required setup fields before networking', () async {
    final state = CodexAppState(_TestBridge())
      ..serverUrl = ''
      ..token = '';
    addTearDown(state.dispose);

    expect(await state.login(), isFalse);
    expect(state.busy, isFalse);
    expect(state.errorMessage, contains('服务地址'));

    state
      ..serverUrl = 'http://192.168.2.15:18637'
      ..token = '';

    expect(await state.login(), isFalse);
    expect(state.busy, isFalse);
    expect(state.errorMessage, contains('访问 Token'));
  });

  test(
    'android login rejects loopback server urls before networking',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      final state = CodexAppState(_TestBridge())
        ..serverUrl = 'http://127.0.0.1:18637'
        ..token = 'token';
      addTearDown(() {
        debugDefaultTargetPlatformOverride = null;
        state.dispose();
      });

      expect(await state.login(), isFalse);
      expect(state.busy, isFalse);
      expect(state.errorMessage, contains('不能使用 127.0.0.1'));
    },
  );

  test('notifies when a background turn completes once', () async {
    final bridge = _TestBridge();
    final state = CodexAppState(bridge)
      ..appInForeground = false
      ..sessions = [SessionItem(threadId: 'thread-1', name: '测试会话')];
    addTearDown(state.dispose);

    state.handleServerMessage({
      'type': 'turn_started',
      'threadId': 'thread-1',
      'turnId': 'turn-1',
      'startedAt': 1000,
    });
    state.handleServerMessage({
      'type': 'turn_completed',
      'threadId': 'thread-1',
      'turnId': 'turn-1',
    });
    state.handleServerMessage({
      'type': 'turn_completed',
      'threadId': 'thread-1',
      'turnId': 'turn-1',
    });
    await Future<void>.delayed(Duration.zero);

    expect(bridge.notifications, hasLength(1));
    expect(bridge.notifications.single['title'], 'Codex 任务已完成');
    expect(bridge.notifications.single['body'], contains('测试会话'));
  });

  test(
    'coalesces server message UI notifications around background resume',
    () async {
      final state = CodexAppState(_TestBridge());
      addTearDown(state.dispose);
      var notifications = 0;
      state.addListener(() {
        notifications += 1;
      });

      state.setAppForeground(false);
      state.handleServerMessage({
        'type': 'token_usage',
        'threadId': 'thread-1',
        'usage': {'totalTokens': 1},
      });
      state.handleServerMessage({
        'type': 'token_usage',
        'threadId': 'thread-1',
        'usage': {'totalTokens': 2},
      });
      await Future<void>.delayed(const Duration(milliseconds: 80));

      expect(notifications, 0);

      state.setAppForeground(true);
      await Future<void>.delayed(const Duration(milliseconds: 80));

      expect(notifications, 1);

      state.handleServerMessage({
        'type': 'token_usage',
        'threadId': 'thread-1',
        'usage': {'totalTokens': 3},
      });
      state.handleServerMessage({
        'type': 'token_usage',
        'threadId': 'thread-1',
        'usage': {'totalTokens': 4},
      });
      await Future<void>.delayed(const Duration(milliseconds: 80));

      expect(notifications, 2);
    },
  );

  test('routes streaming timeline updates away from shell rebuilds', () async {
    final state = CodexAppState(_TestBridge());
    addTearDown(state.dispose);
    var shellNotifications = 0;
    var timelineNotifications = 0;
    state.addListener(() {
      shellNotifications += 1;
    });
    state.timelineNotifier.addListener(() {
      timelineNotifications += 1;
    });

    state.handleServerMessage({
      'type': 'agent_delta',
      'threadId': 'thread-1',
      'turnId': 'turn-1',
      'itemId': 'assistant-1',
      'delta': 'hello',
      'createdAt': 1,
    });
    state.handleServerMessage({
      'type': 'agent_delta',
      'threadId': 'thread-1',
      'turnId': 'turn-1',
      'itemId': 'assistant-1',
      'delta': ' world',
      'createdAt': 2,
    });
    await Future<void>.delayed(const Duration(milliseconds: 80));

    expect(shellNotifications, 0);
    expect(timelineNotifications, 1);
    expect(state.timelineByThread['thread-1']?.single.text, 'hello world');
  });

  test('coalesces background timeline refreshes until resume', () async {
    final state = CodexAppState(_TestBridge());
    addTearDown(state.dispose);
    var timelineNotifications = 0;
    state.timelineNotifier.addListener(() {
      timelineNotifications += 1;
    });

    state.setAppForeground(false);
    state.handleServerMessage({
      'type': 'agent_delta',
      'threadId': 'thread-1',
      'turnId': 'turn-1',
      'itemId': 'assistant-1',
      'delta': 'background',
      'createdAt': 1,
    });
    await Future<void>.delayed(const Duration(milliseconds: 80));

    expect(timelineNotifications, 0);

    state.setAppForeground(true);
    await Future<void>.delayed(const Duration(milliseconds: 80));

    expect(timelineNotifications, 1);
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

  test('restores turn plans from loose maps and replayed updates', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-plan';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [],
      'turnPlans': [
        <String, Object?>{
          'turnId': 'turn-plan-sync',
          'steps': [
            <String, Object?>{'text': '同步计划步骤', 'status': 'completed'},
          ],
          'updatedAt': 1000,
        },
      ],
      'timelineEvents': [
        <String, Object?>{
          'type': 'turn_plan_updated',
          'threadId': threadId,
          'turnId': 'turn-plan-event',
          'plan': [
            '字符串计划步骤',
            <String, Object?>{'title': '事件计划步骤', 'status': 'inProgress'},
          ],
          'updatedAt': 1001,
        },
      ],
    });

    final plans = state.activeTimeline
        .where((entry) => entry.type == 'turn_plan')
        .toList(growable: false);
    expect(plans, hasLength(2));
    expect(plans.first.meta.single, '已完成 · 同步计划步骤');
    expect(plans.last.meta, contains('待处理 · 字符串计划步骤'));
    expect(plans.last.meta, contains('进行中 · 事件计划步骤'));
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

  test(
    'orders replayed timeline events by server sequence when timestamps tie',
    () {
      final state = CodexAppState(_TestBridge());
      const threadId = 'thread-sequence';
      state.activeSessionId = threadId;

      state.handleServerMessage({
        'type': 'thread_sync',
        'threadId': threadId,
        'turns': [],
        'timelineEvents': [
          {
            'type': 'thread_event',
            'threadId': threadId,
            'itemId': 'event-2',
            'method': 'process/outputDelta',
            'message': 'second',
            'createdAt': 1000,
            'sequence': 2,
          },
          {
            'type': 'thread_event',
            'threadId': threadId,
            'itemId': 'event-1',
            'method': 'process/outputDelta',
            'message': 'first',
            'createdAt': 1000,
            'sequence': 1,
          },
        ],
      });

      final entries = state.activeTimeline
          .where((entry) => entry.type == 'thread_event')
          .toList(growable: false);
      expect(entries.map((entry) => entry.text), ['first', 'second']);
      state.dispose();
    },
  );

  test('restores working state from replayed turn events', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-working-replay';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [],
      'timelineEvents': [
        {
          'type': 'turn_started',
          'threadId': threadId,
          'turnId': 'turn-working',
          'startedAt': 2000,
          'sequence': 1,
        },
      ],
    });

    expect(state.isWorking, isTrue);

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [],
      'timelineEvents': [
        {
          'type': 'turn_started',
          'threadId': threadId,
          'turnId': 'turn-working',
          'startedAt': 2000,
          'sequence': 1,
        },
        {
          'type': 'turn_completed',
          'threadId': threadId,
          'turnId': 'turn-working',
          'createdAt': 3000,
          'sequence': 2,
        },
      ],
    });

    expect(state.isWorking, isFalse);
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

  test('thread sync can activate an unknown session and show messages', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-from-sync';

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-from-sync',
          'status': 'completed',
          'items': [
            {
              'id': 'assistant-from-sync',
              'type': 'agentMessage',
              'text': '同步回复',
            },
          ],
        },
      ],
    });

    expect(state.activeSessionId, threadId);
    expect(state.activeSession?.threadId, threadId);
    expect(
      state.activeTimeline.any(
        (entry) => entry.id == 'assistant-from-sync' && entry.text == '同步回复',
      ),
      isTrue,
    );
    state.dispose();
  });

  test('thread sync keeps completed assistant text over replayed deltas', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-completed-over-delta';
    const fullText = '这是完整的助手回复，不能被后续流式片段覆盖。';

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'timelineEvents': [
        {
          'type': 'item_completed',
          'threadId': threadId,
          'turnId': 'turn-completed-over-delta',
          'itemId': 'assistant-completed-over-delta',
          'completedAt': 3000,
          'item': {
            'id': 'assistant-completed-over-delta',
            'type': 'agentMessage',
            'status': 'completed',
            'startedAt': 1000,
            'text': fullText,
          },
        },
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-completed-over-delta',
          'itemId': 'assistant-completed-over-delta',
          'delta': '覆盖',
          'createdAt': 2000,
        },
      ],
    });

    final assistantEntries = state.activeTimeline
        .where(
          (entry) =>
              entry.type == 'message' &&
              entry.role == 'assistant' &&
              entry.itemId == 'assistant-completed-over-delta',
        )
        .toList(growable: false);

    expect(assistantEntries, hasLength(1));
    expect(assistantEntries.single.text, fullText);
    expect(assistantEntries.single.partial, isFalse);
    state.dispose();
  });

  test('thread sync uses deltas when completed assistant item has no text', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-empty-completed-fallback';

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'timelineEvents': [
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-empty-completed-fallback',
          'itemId': 'assistant-empty-completed-fallback',
          'delta': '流式',
          'sequence': 1,
        },
        {
          'type': 'agent_delta',
          'threadId': threadId,
          'turnId': 'turn-empty-completed-fallback',
          'itemId': 'assistant-empty-completed-fallback',
          'delta': '兜底',
          'sequence': 2,
        },
        {
          'type': 'item_completed',
          'threadId': threadId,
          'turnId': 'turn-empty-completed-fallback',
          'itemId': 'assistant-empty-completed-fallback',
          'sequence': 3,
          'item': {
            'id': 'assistant-empty-completed-fallback',
            'type': 'agentMessage',
            'status': 'completed',
          },
        },
      ],
    });

    final assistant = state.activeTimeline.singleWhere(
      (entry) => entry.itemId == 'assistant-empty-completed-fallback',
    );
    expect(assistant.text, '流式兜底');
    expect(assistant.partial, isFalse);
    state.dispose();
  });

  test('restores alternate message item names and loose map payloads', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-alternate-message';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        <String, Object?>{
          'id': 'turn-alternate-message',
          'status': 'completed',
          'items': [
            <String, Object?>{
              'id': 'user-snake',
              'type': 'user_message',
              'content': [
                <String, Object?>{'type': 'text', 'text': '蛇形用户消息'},
              ],
            },
            <String, Object?>{
              'id': 'assistant-snake',
              'type': 'assistant_message',
              'content': [
                <String, Object?>{'type': 'output_text', 'text': '蛇形助手回复'},
              ],
            },
          ],
        },
      ],
    });

    expect(
      state.activeTimeline.any(
        (entry) => entry.id == 'user-snake' && entry.text == '蛇形用户消息',
      ),
      isTrue,
    );
    expect(
      state.activeTimeline.any(
        (entry) => entry.id == 'assistant-snake' && entry.text == '蛇形助手回复',
      ),
      isTrue,
    );
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

  test('preserves per-file diffs from file change payloads', () {
    final state = CodexAppState(_TestBridge());
    const threadId = 'thread-file-diff';
    state.activeSessionId = threadId;

    state.handleServerMessage({
      'type': 'thread_sync',
      'threadId': threadId,
      'turns': [
        {
          'id': 'turn-file-diff',
          'status': 'completed',
          'items': [
            {
              'id': 'file-diff',
              'type': 'fileChange',
              'status': 'completed',
              'changes': [
                <String, Object?>{
                  'path': 'lib/main.dart',
                  'kind': 'update',
                  'diff': '@@ -1,1 +1,1 @@\n-old\n+new',
                },
              ],
            },
          ],
        },
      ],
    });

    final fileEntry = state.activeTimeline.singleWhere(
      (entry) => entry.id == 'file-diff',
    );
    expect(fileEntry.type, 'file_change');
    expect(fileEntry.patch, isEmpty);
    expect(fileEntry.changes.single['diff'], contains('+new'));
    state.dispose();
  });
}

class _TestBridge extends NativeBridge {
  final Map<String, String> values = {};
  final List<Map<String, Object?>> notifications = [];
  final List<String> downloadedUrls = [];
  final List<int> downloadedMaxConnections = [];
  final List<String> installedApks = [];
  final StreamController<UpdateDownloadProgress> _downloadProgress =
      StreamController<UpdateDownloadProgress>.broadcast();
  DownloadedApk downloadedApk = const DownloadedApk(
    fileName: 'codex-remote-update.apk',
    sizeBytes: 0,
  );
  Object? downloadError;

  @override
  Stream<UpdateDownloadProgress> get downloadProgress =>
      _downloadProgress.stream;

  void emitDownloadProgress(UpdateDownloadProgress progress) {
    _downloadProgress.add(progress);
  }

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

  @override
  Future<DownloadedApk> downloadUpdateApk({
    required String url,
    required String fileName,
    required int maxConnections,
  }) async {
    downloadedUrls.add(url);
    downloadedMaxConnections.add(maxConnections);
    final error = downloadError;
    if (error != null) {
      throw error;
    }
    return downloadedApk;
  }

  @override
  Future<void> installDownloadedApk({required String fileName}) async {
    installedApks.add(fileName);
  }

  @override
  Future<void> cancelUpdateDownload() async {}

  @override
  Future<void> requestNotificationPermission() async {}

  @override
  Future<void> showNotification({
    required int id,
    required String title,
    required String body,
  }) async {
    notifications.add({'id': id, 'title': title, 'body': body});
  }
}
