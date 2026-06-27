import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'models.dart';

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class CodexApi {
  CodexApi({required String baseUrl, this.cookie = ''})
    : baseUri = _normalizeBaseUri(baseUrl);

  static const Duration _requestTimeout = Duration(seconds: 12);

  final Uri baseUri;
  String cookie;
  final HttpClient _client = HttpClient()..connectionTimeout = _requestTimeout;

  static Uri _normalizeBaseUri(String value) {
    final trimmed = value.trim();
    final withScheme =
        trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : 'http://$trimmed';
    final parsed = Uri.parse(withScheme);
    return parsed.path.isEmpty ? parsed.replace(path: '/') : parsed;
  }

  Uri url(String path, [Map<String, String?> query = const {}]) {
    final cleanQuery = <String, String>{};
    for (final entry in query.entries) {
      final value = entry.value;
      if (value != null && value.isNotEmpty) {
        cleanQuery[entry.key] = value;
      }
    }
    return baseUri
        .resolve(path)
        .replace(queryParameters: cleanQuery.isEmpty ? null : cleanQuery);
  }

  Uri wsUrl() {
    final scheme = baseUri.scheme == 'https' ? 'wss' : 'ws';
    return baseUri.replace(scheme: scheme).resolve('/ws');
  }

  Future<JsonMap> getJson(
    String path, {
    Map<String, String?> query = const {},
  }) async {
    final request = await _client
        .getUrl(url(path, query))
        .timeout(_requestTimeout);
    _applyCommonHeaders(request);
    return _readJson(await request.close().timeout(_requestTimeout));
  }

  Future<JsonMap> postJson(
    String path,
    JsonMap body, {
    String token = '',
  }) async {
    final request = await _client.postUrl(url(path)).timeout(_requestTimeout);
    _applyCommonHeaders(request);
    if (token.isNotEmpty) {
      request.headers.set('x-codex-remote-token', token);
    }
    final payload = utf8.encode(jsonEncode(body));
    request.headers.contentType = ContentType.json;
    request.contentLength = payload.length;
    request.add(payload);
    return _readJson(
      await request.close().timeout(_requestTimeout),
      captureCookie: true,
    );
  }

  Future<JsonMap> deleteJson(String path) async {
    final request = await _client.deleteUrl(url(path)).timeout(_requestTimeout);
    _applyCommonHeaders(request);
    return _readJson(
      await request.close().timeout(_requestTimeout),
      captureCookie: true,
    );
  }

  Future<JsonMap> uploadImage({
    required Uint8List bytes,
    required String fileName,
    required String contentType,
  }) async {
    final request = await _client
        .postUrl(url('/api/uploads/image'))
        .timeout(_requestTimeout);
    _applyCommonHeaders(request);
    request.headers.set(
      HttpHeaders.contentTypeHeader,
      contentType.isEmpty ? 'application/octet-stream' : contentType,
    );
    request.headers.set('x-upload-filename', Uri.encodeComponent(fileName));
    request.contentLength = bytes.length;
    request.add(bytes);
    return _readJson(await request.close().timeout(_requestTimeout));
  }

  Future<WebSocket> connectWebSocket() {
    final headers = <String, dynamic>{};
    if (cookie.isNotEmpty) {
      headers[HttpHeaders.cookieHeader] = cookie;
    }
    return WebSocket.connect(
      wsUrl().toString(),
      headers: headers,
    ).timeout(_requestTimeout);
  }

  void _applyCommonHeaders(HttpClientRequest request) {
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    if (cookie.isNotEmpty) {
      request.headers.set(HttpHeaders.cookieHeader, cookie);
    }
  }

  Future<JsonMap> _readJson(
    HttpClientResponse response, {
    bool captureCookie = false,
  }) async {
    if (captureCookie) {
      _captureCookie(response);
    }
    final text = await response
        .transform(utf8.decoder)
        .join()
        .timeout(_requestTimeout);
    JsonMap payload = const {};
    if (text.trim().isNotEmpty) {
      final decoded = jsonDecode(text);
      if (decoded is JsonMap) {
        payload = decoded;
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        readString(payload, 'message', '请求失败：${response.statusCode}'),
      );
    }
    return payload;
  }

  void _captureCookie(HttpClientResponse response) {
    final values = response.headers[HttpHeaders.setCookieHeader];
    if (values == null || values.isEmpty) {
      return;
    }
    final first = values.first.split(';').first.trim();
    if (first.isNotEmpty) {
      cookie = first;
    }
  }

  void close() {
    _client.close(force: true);
  }
}

class CodexSocket {
  CodexSocket(this.api);

  final CodexApi api;
  WebSocket? _socket;
  bool _closed = false;
  final StreamController<JsonMap> _messages =
      StreamController<JsonMap>.broadcast();
  final StreamController<String> _status = StreamController<String>.broadcast();

  Stream<JsonMap> get messages => _messages.stream;
  Stream<String> get status => _status.stream;

  Future<void> connect() async {
    _closed = false;
    await _connectOnce();
  }

  Future<void> _connectOnce() async {
    _status.add('connecting');
    try {
      final socket = await api.connectWebSocket();
      _socket = socket;
      _status.add('connected');
      socket.listen(
        (event) {
          if (event is String) {
            final decoded = jsonDecode(event);
            if (decoded is JsonMap) {
              _messages.add(decoded);
            }
          }
        },
        onError: (Object error) {
          if (!_closed) {
            _status.add('disconnected');
            unawaited(_reconnect());
          }
        },
        onDone: () {
          if (!_closed) {
            _status.add('disconnected');
            unawaited(_reconnect());
          }
        },
        cancelOnError: true,
      );
    } catch (_) {
      if (!_closed) {
        _status.add('disconnected');
        unawaited(_reconnect());
      }
    }
  }

  Future<void> _reconnect() async {
    await Future<void>.delayed(const Duration(seconds: 2));
    if (!_closed) {
      await _connectOnce();
    }
  }

  void send(JsonMap message) {
    final socket = _socket;
    if (socket == null || socket.readyState != WebSocket.open) {
      return;
    }
    socket.add(jsonEncode(message));
  }

  Future<void> close() async {
    _closed = true;
    final socket = _socket;
    _socket = null;
    await socket?.close();
    _status.add('idle');
  }

  Future<void> dispose() async {
    await close();
    await _messages.close();
    await _status.close();
  }
}
