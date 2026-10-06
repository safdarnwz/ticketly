import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../app/config.dart';
import 'device.dart';
import 'json.dart';

/// Any failed API call. [message] is always safe to show to the member.
class ApiError implements Exception {
  final int status;
  final String code;
  final String message;
  final String? feature;
  final Map<String, String> errors;
  const ApiError(this.status, this.code, this.message, {this.feature, this.errors = const {}});

  bool get isNetwork => code == 'NETWORK' || code == 'TIMEOUT';
  bool get isUpgrade => status == 402;

  @override
  String toString() => message;
}

/// Message for anything thrown.
String errorText(Object? e) {
  if (e is ApiError) return e.message;
  return 'Something went wrong. Please try again.';
}

class UpgradeEvent {
  final String message;
  final String? feature;
  final String code;
  const UpgradeEvent(this.message, this.feature, this.code);
}

/// One page of a list, plus the total the server reports.
class Paged<T> {
  final List<T> items;
  final int total;
  final Json meta;
  const Paged(this.items, this.total, this.meta);
}

/// The session the server hands back after sign-in or refresh.
class SessionData {
  final String accessToken;
  final int expiresIn;
  final Json user;
  const SessionData(this.accessToken, this.expiresIn, this.user);
}

/// The refresh token lives in the phone's secure storage (Keychain / Keystore).
class TokenStore {
  static const _key = 'ss_refresh';
  static const _storage = FlutterSecureStorage(
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
  );
  static String? _cache;
  static bool _loaded = false;

  static Future<String?> read() async {
    if (_loaded) return _cache;
    try {
      _cache = await _storage.read(key: _key);
    } catch (_) {
      // A damaged keystore (e.g. after a device restore) means "signed out", never a crash.
      _cache = null;
      try {
        await _storage.delete(key: _key);
      } catch (_) {}
    }
    _loaded = true;
    return _cache;
  }

  static Future<void> write(String token) async {
    _cache = token;
    _loaded = true;
    try {
      await _storage.write(key: _key, value: token);
    } catch (_) {
      // Keeps working for this run; the member signs in again next launch.
    }
  }

  static Future<void> clear() async {
    _cache = null;
    _loaded = true;
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}

/// HTTP client for the 2ndShaadi API: access token in memory, refresh token in
/// secure storage, one shared refresh at a time, and transient failures
/// (offline, busy server) never sign the member out.
class Api {
  Api._();
  static final Api instance = Api._();

  late final Dio _dio = Dio(BaseOptions(
    baseUrl: AppConfig.apiBase,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    sendTimeout: const Duration(seconds: 90),
    // Every status comes back as a response; we turn it into ApiError ourselves.
    validateStatus: (_) => true,
    headers: {'X-Client': 'app', if (!kIsWeb) 'User-Agent': DeviceInfo.userAgent},
  ));

  String? _access;
  DateTime _accessExpires = DateTime.fromMillisecondsSinceEpoch(0);
  Future<SessionData?>? _refreshing;
  Timer? _renewTimer;

  final _upgrade = StreamController<UpgradeEvent>.broadcast();
  final _maintenance = StreamController<void>.broadcast();
  final _ended = StreamController<void>.broadcast();
  final _sessions = StreamController<SessionData>.broadcast();

  /// A plan limit or paid feature was hit (HTTP 402).
  Stream<UpgradeEvent> get upgradeRequired => _upgrade.stream;

  /// The server answered "maintenance mode".
  Stream<void> get maintenance => _maintenance.stream;

  /// The session ended on the server (signed out elsewhere, account closed).
  Stream<void> get sessionEnded => _ended.stream;

  /// A new access token (after a refresh). Carries the latest account summary.
  Stream<SessionData> get sessionRenewed => _sessions.stream;

  String? get accessToken => _access;
  bool get hasAccess => _access != null;
  bool get accessStale => _access == null || DateTime.now().isAfter(_accessExpires.subtract(const Duration(seconds: 30)));

  /// Saves a session from sign-in, registration or refresh.
  Future<SessionData> applySession(Json data) async {
    final s = SessionData(str(data['accessToken']), integer(data['expiresIn'], 900), asMap(data['user']));
    final refresh = strN(data['refreshToken']);
    if (refresh != null) await TokenStore.write(refresh);
    _access = s.accessToken;
    _accessExpires = DateTime.now().add(Duration(seconds: s.expiresIn));
    _scheduleRenewal(Duration(seconds: s.expiresIn - 60));
    return s;
  }

  Future<void> clearSession() async {
    _access = null;
    _renewTimer?.cancel();
    await TokenStore.clear();
  }

  void _scheduleRenewal(Duration delay) {
    _renewTimer?.cancel();
    if (_access == null) return;
    final wait = delay < const Duration(seconds: 5) ? const Duration(seconds: 5) : delay;
    _renewTimer = Timer(wait, () {
      refreshSession().catchError((_) {
        _scheduleRenewal(const Duration(seconds: 30));
        return null;
      });
    });
  }

  /// Exchanges the refresh token for a new access token. Concurrent callers
  /// share one request. Returns null only when there is definitely no session;
  /// throws on offline / busy server so the member stays signed in.
  Future<SessionData?> refreshSession() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<SessionData?> _doRefresh() async {
    final token = await TokenStore.read();
    if (token == null) return null;
    final res = await _send('POST', '/auth/refresh', data: {'refreshToken': token}, auth: false);
    final body = _decode(res.data);
    final status = res.statusCode ?? 0;
    if (status == 401 || status == 403) {
      final hadSession = _access != null;
      await clearSession();
      if (hadSession) _ended.add(null);
      return null;
    }
    if (status < 200 || status >= 300) throw _errorFrom(status, body);
    final data = body['data'];
    if (data is! Map) {
      await clearSession();
      return null;
    }
    final s = await applySession(asMap(data));
    _sessions.add(s);
    return s;
  }

  Future<Response<dynamic>> _send(
    String method,
    String path, {
    Object? data,
    Map<String, dynamic>? query,
    bool auth = true,
    CancelToken? cancel,
    ResponseType? responseType,
    Duration? timeout,
  }) async {
    try {
      return await _dio.request<dynamic>(
        path,
        data: data,
        queryParameters: query,
        cancelToken: cancel,
        options: Options(
          method: method,
          responseType: responseType,
          receiveTimeout: timeout,
          sendTimeout: timeout,
          headers: {if (auth && _access != null) 'Authorization': 'Bearer $_access'},
        ),
      );
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) rethrow;
      final timeoutHit = e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.sendTimeout;
      throw ApiError(
        0,
        timeoutHit ? 'TIMEOUT' : 'NETWORK',
        timeoutHit
            ? 'This is taking too long. Check your connection and try again.'
            : 'You appear to be offline. Check your connection and try again.',
      );
    }
  }

  Json _decode(Object? data) {
    if (data is Map) return asMap(data);
    if (data is String && data.isNotEmpty) {
      try {
        return asMap(jsonDecode(data));
      } catch (_) {}
    }
    return <String, dynamic>{};
  }

  ApiError _errorFrom(int status, Json body) {
    final errors = asMap(body['errors']).map((k, v) => MapEntry(k, '$v'));
    String message = str(body['message']);
    if (message.isEmpty) {
      message = status >= 500
          ? 'Something went wrong on our side. Please try again.'
          : status == 429
              ? 'Too many tries. Please wait a moment and try again.'
              : 'Request failed. Please try again.';
    }
    return ApiError(status, str(body['code'], status >= 500 ? 'SERVER' : 'ERROR'), message,
        feature: strN(body['feature']), errors: errors);
  }

  Future<Json> _call(
    String method,
    String path, {
    Object? data,
    Map<String, dynamic>? query,
    bool auth = true,
    bool quiet = false,
    CancelToken? cancel,
    Duration? timeout,
  }) async {
    // A token that ran out while the phone slept: renew it first.
    if (auth && _access != null && accessStale) {
      await refreshSession().catchError((_) => null);
    }
    var res = await _send(method, path, data: data, query: query, auth: auth, cancel: cancel, timeout: timeout);
    if (res.statusCode == 401 && auth && _access != null) {
      final s = await refreshSession().catchError((_) => null);
      if (s != null) {
        res = await _send(method, path, data: data, query: query, auth: auth, cancel: cancel, timeout: timeout);
      }
    }
    final status = res.statusCode ?? 0;
    final body = _decode(res.data);
    if (status == 402 && !quiet) {
      _upgrade.add(UpgradeEvent(
        str(body['message'], 'Upgrade your plan to continue.'),
        strN(body['feature']),
        str(body['code']),
      ));
    }
    if (status == 503 && body['code'] == 'MAINTENANCE') _maintenance.add(null);
    if (status < 200 || status >= 300) throw _errorFrom(status, body);
    return body;
  }

  /// `data` from the response envelope.
  Future<dynamic> get(String path, {Map<String, dynamic>? query, bool auth = true, bool quiet = false, CancelToken? cancel}) async =>
      (await _call('GET', path, query: query, auth: auth, quiet: quiet, cancel: cancel))['data'];

  Future<dynamic> post(String path, [Object? body, bool auth = true, bool quiet = false]) async =>
      (await _call('POST', path, data: body ?? <String, dynamic>{}, auth: auth, quiet: quiet))['data'];

  Future<dynamic> patch(String path, [Object? body]) async =>
      (await _call('PATCH', path, data: body ?? <String, dynamic>{}))['data'];

  Future<dynamic> put(String path, [Object? body]) async =>
      (await _call('PUT', path, data: body ?? <String, dynamic>{}))['data'];

  Future<dynamic> delete(String path, [Object? body]) async => (await _call('DELETE', path, data: body))['data'];

  /// A paginated list: `{ data: [...], meta: { total } }`.
  Future<Paged<T>> page<T>(String path, T Function(Json) f,
      {Map<String, dynamic>? query, bool quiet = false, CancelToken? cancel}) async {
    final body = await _call('GET', path, query: query, quiet: quiet, cancel: cancel);
    final meta = asMap(body['meta']);
    final items = asList(body['data'], f);
    return Paged(items, integer(meta['total'], items.length), meta);
  }

  /// Uploads a photo (multipart).
  Future<dynamic> upload(String path, Uint8List bytes, String filename, String mime) async {
    final parts = mime.split('/');
    final form = FormData.fromMap({
      'photo': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType(parts[0], parts.last)),
    });
    return (await _call('POST', path, data: form, timeout: const Duration(seconds: 120)))['data'];
  }

  /// Downloads a file (invoice PDF). Returns the bytes and the server's file name.
  Future<(Uint8List, String?)> download(String path) async {
    if (_access != null && accessStale) await refreshSession().catchError((_) => null);
    var res = await _send('GET', path, responseType: ResponseType.bytes, timeout: const Duration(seconds: 60));
    if (res.statusCode == 401) {
      final s = await refreshSession().catchError((_) => null);
      if (s != null) res = await _send('GET', path, responseType: ResponseType.bytes);
    }
    final status = res.statusCode ?? 0;
    final raw = res.data;
    final bytes = raw is Uint8List ? raw : raw is List<int> ? Uint8List.fromList(raw) : Uint8List(0);
    if (status < 200 || status >= 300) {
      Json body = {};
      try {
        body = asMap(jsonDecode(utf8.decode(bytes)));
      } catch (_) {}
      throw _errorFrom(status, body);
    }
    final cd = res.headers.value('content-disposition') ?? '';
    final name = RegExp(r'filename="([^"]+)"').firstMatch(cd)?.group(1);
    return (bytes, name);
  }

  /// Fire-and-forget POST for analytics: never throws, never refreshes.
  Future<void> beacon(String path, Json body) async {
    try {
      await _dio.post<dynamic>(path,
          data: body,
          options: Options(
            headers: {if (_access != null) 'Authorization': 'Bearer $_access'},
            receiveTimeout: const Duration(seconds: 10),
          ));
    } catch (_) {}
  }

  /// Absolute address for a photo or other media path from the API.
  static String? mediaUrl(String? path) {
    if (path == null || path.isEmpty) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/')) return '${AppConfig.apiOrigin}$path';
    return '${AppConfig.apiOrigin}/$path';
  }
}
