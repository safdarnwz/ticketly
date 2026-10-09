import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'api.dart';

/// Visits, screens and time in the app for the admin analytics page.
/// Only counts time while the app is on screen. Never throws.
class Tracker {
  Tracker._();
  static final Tracker instance = Tracker._();

  static const _gap = Duration(minutes: 30);
  String? _visitorId;
  String? _visitId;
  DateTime _lastActive = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime? _lastPing;
  Timer? _timer;
  String? _lastPath;
  DateTime _lastPathAt = DateTime.fromMillisecondsSinceEpoch(0);

  bool get _enabled => !kIsWeb;

  Future<void> _ensureVisitor() async {
    if (_visitorId != null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      _visitorId = prefs.getString('ss_vid');
      if (_visitorId == null) {
        _visitorId = const Uuid().v4();
        await prefs.setString('ss_vid', _visitorId!);
      }
    } catch (_) {
      _visitorId ??= const Uuid().v4();
    }
  }

  /// A screen was opened.
  Future<void> page(String path) async {
    if (!_enabled) return;
    final now = DateTime.now();
    if (path == _lastPath && now.difference(_lastPathAt) < const Duration(milliseconds: 1500)) return;
    _lastPath = path;
    _lastPathAt = now;
    await _ensureVisitor();
    if (_visitId == null || now.difference(_lastActive) > _gap) {
      _visitId = const Uuid().v4();
      _lastPing = now;
    }
    _lastActive = now;
    await Api.instance.beacon('/track/visit', {
      'visitId': _visitId,
      'visitorId': _visitorId,
      'path': path,
      'hints': {'mobile': true},
    });
  }

  void event(String name, [Map<String, Object> props = const {}]) {
    if (!_enabled) return;
    Api.instance.beacon('/track/event', {'visitId': ?_visitId, 'name': name, 'props': props});
  }

  /// App on screen: count time every 30 seconds.
  void resumed() {
    if (!_enabled) return;
    _lastPing = DateTime.now();
    if (DateTime.now().difference(_lastActive) > _gap) _visitId = null;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _ping());
    if (_visitId == null && _lastPath != null) {
      final p = _lastPath!;
      _lastPath = null;
      page(p);
    }
  }

  /// App in the background: send the last bit of time and stop counting.
  void paused() {
    if (!_enabled) return;
    _ping();
    _timer?.cancel();
    _timer = null;
    _lastPing = null;
  }

  void _ping() {
    final id = _visitId;
    final since = _lastPing;
    if (id == null || since == null) return;
    final now = DateTime.now();
    final seconds = now.difference(since).inSeconds.clamp(0, 120);
    _lastPing = now;
    _lastActive = now;
    if (seconds > 0) Api.instance.beacon('/track/ping', {'visitId': id, 'seconds': seconds});
  }
}
