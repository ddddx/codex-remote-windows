import 'dart:async';

import 'package:flutter/services.dart';

class PickedImage {
  const PickedImage({
    required this.name,
    required this.mimeType,
    required this.bytes,
  });

  final String name;
  final String mimeType;
  final Uint8List bytes;
}

class AppVersionInfo {
  const AppVersionInfo({
    required this.packageName,
    required this.versionName,
    required this.versionCode,
  });

  final String packageName;
  final String versionName;
  final int versionCode;
}

class UpdateDownloadProgress {
  const UpdateDownloadProgress({
    required this.status,
    required this.url,
    required this.fileName,
    required this.downloadedBytes,
    required this.totalBytes,
    required this.bytesPerSecond,
    required this.progress,
    required this.accelerated,
    required this.connections,
    required this.message,
  });

  factory UpdateDownloadProgress.fromMap(Map<dynamic, dynamic> map) {
    final downloadedBytes = _readNonNegativeInt(map['downloadedBytes']);
    final totalBytes = _readNonNegativeInt(map['totalBytes']);
    final progress = _readDouble(map['progress']);
    return UpdateDownloadProgress(
      status: _readString(map['status']),
      url: _readString(map['url']),
      fileName: _readString(map['fileName']),
      downloadedBytes: downloadedBytes,
      totalBytes: totalBytes,
      bytesPerSecond: _readInt(map['bytesPerSecond']),
      progress: progress > 0
          ? progress.clamp(0, 1).toDouble()
          : totalBytes > 0
          ? (downloadedBytes / totalBytes).clamp(0, 1).toDouble()
          : 0,
      accelerated: map['accelerated'] == true,
      connections: _readInt(map['connections']).clamp(1, 64).toInt(),
      message: _readString(map['message']),
    );
  }

  final String status;
  final String url;
  final String fileName;
  final int downloadedBytes;
  final int totalBytes;
  final int bytesPerSecond;
  final double progress;
  final bool accelerated;
  final int connections;
  final String message;
}

class NativeBridge {
  static const MethodChannel _channel = MethodChannel(
    'codex_remote_mobile/native',
  );
  static final StreamController<UpdateDownloadProgress>
  _downloadProgressController =
      StreamController<UpdateDownloadProgress>.broadcast();
  static bool _methodCallHandlerInstalled = false;

  Stream<UpdateDownloadProgress> get downloadProgress {
    _ensureMethodCallHandler();
    return _downloadProgressController.stream;
  }

  static void _ensureMethodCallHandler() {
    if (_methodCallHandlerInstalled) {
      return;
    }
    _methodCallHandlerInstalled = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'downloadProgress') {
        return null;
      }
      final arguments = call.arguments;
      if (arguments is Map) {
        _downloadProgressController.add(
          UpdateDownloadProgress.fromMap(arguments),
        );
      }
      return null;
    });
  }

  Future<String?> getString(String key) async {
    return _channel.invokeMethod<String>('getString', {'key': key});
  }

  Future<void> setString(String key, String value) async {
    await _channel.invokeMethod<void>('setString', {
      'key': key,
      'value': value,
    });
  }

  Future<void> remove(String key) async {
    await _channel.invokeMethod<void>('remove', {'key': key});
  }

  Future<PickedImage?> pickImage() async {
    final result = await _channel.invokeMapMethod<String, Object?>('pickImage');
    if (result == null) {
      return null;
    }
    final bytes = result['bytes'];
    if (bytes is! Uint8List || bytes.isEmpty) {
      return null;
    }
    return PickedImage(
      name: (result['name'] as String?)?.trim().isNotEmpty == true
          ? result['name'] as String
          : 'image',
      mimeType: (result['mimeType'] as String?)?.trim().isNotEmpty == true
          ? result['mimeType'] as String
          : 'image/*',
      bytes: bytes,
    );
  }

  Future<AppVersionInfo> getAppVersion() async {
    final result = await _channel.invokeMapMethod<String, Object?>(
      'getAppVersion',
    );
    return AppVersionInfo(
      packageName: (result?['packageName'] as String?) ?? '',
      versionName: (result?['versionName'] as String?) ?? '',
      versionCode: (result?['versionCode'] as num?)?.round() ?? 0,
    );
  }

  Future<void> openUrl(String url) async {
    await _channel.invokeMethod<void>('openUrl', {'url': url});
  }

  Future<void> downloadAndInstallApk({
    required String url,
    required String fileName,
  }) async {
    await _channel.invokeMethod<void>('downloadAndInstallApk', {
      'url': url,
      'fileName': fileName,
    });
  }

  Future<void> startBackgroundKeepAlive({
    required String title,
    required String body,
  }) async {
    await _channel.invokeMethod<void>('startBackgroundKeepAlive', {
      'title': title,
      'body': body,
    });
  }

  Future<void> stopBackgroundKeepAlive() async {
    await _channel.invokeMethod<void>('stopBackgroundKeepAlive');
  }

  Future<void> requestNotificationPermission() async {
    await _channel.invokeMethod<void>('requestNotificationPermission');
  }

  Future<void> showNotification({
    required int id,
    required String title,
    required String body,
  }) async {
    await _channel.invokeMethod<void>('showNotification', {
      'id': id,
      'title': title,
      'body': body,
    });
  }
}

String _readString(Object? value) => value is String ? value : '';

int _readInt(Object? value) => value is num ? value.round() : 0;

int _readNonNegativeInt(Object? value) {
  final result = _readInt(value);
  return result < 0 ? 0 : result;
}

double _readDouble(Object? value) => value is num ? value.toDouble() : 0;
