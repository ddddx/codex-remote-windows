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

class NativeBridge {
  static const MethodChannel _channel = MethodChannel('codex_remote_mobile/native');

  Future<String?> getString(String key) async {
    return _channel.invokeMethod<String>('getString', {'key': key});
  }

  Future<void> setString(String key, String value) async {
    await _channel.invokeMethod<void>('setString', {'key': key, 'value': value});
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
      name: (result['name'] as String?)?.trim().isNotEmpty == true ? result['name'] as String : 'image',
      mimeType: (result['mimeType'] as String?)?.trim().isNotEmpty == true ? result['mimeType'] as String : 'image/*',
      bytes: bytes,
    );
  }
}
