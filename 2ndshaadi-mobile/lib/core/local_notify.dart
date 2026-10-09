import 'dart:ui' show Color;

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:share_plus/share_plus.dart';

/// Phone notifications for new interests and messages that arrive while the
/// app is open in the background. (Delivery while the app is fully closed
/// needs Firebase Cloud Messaging; see mobile/README.md.)
class LocalNotify {
  LocalNotify._();
  static final instance = LocalNotify._();
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;
  int _id = 0;

  /// Called with the link of a tapped notification.
  void Function(String? link)? onOpen;

  Future<void> init() async {
    if (kIsWeb || _ready) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(
            requestAlertPermission: false,
            requestBadgePermission: false,
            requestSoundPermission: false,
          ),
        ),
        onDidReceiveNotificationResponse: (r) => onOpen?.call(r.payload),
      );
      _ready = true;
    } catch (_) {}
  }

  /// Asks for permission (Android 13+ and iOS). Returns whether notifications are allowed.
  Future<bool> request() async {
    if (kIsWeb) return false;
    await init();
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        final a = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
        return await a?.requestNotificationsPermission() ?? false;
      }
      final i = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
      return await i?.requestPermissions(alert: true, badge: true, sound: true) ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> enabled() async {
    if (kIsWeb) return false;
    await init();
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        final a = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
        return await a?.areNotificationsEnabled() ?? false;
      }
      final i = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
      final s = await i?.checkPermissions();
      return s?.isEnabled ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<void> show(String title, String body, {String? link}) async {
    if (kIsWeb) return;
    await init();
    if (!_ready) return;
    try {
      await _plugin.show(
        id: _id++ % 1000,
        title: title,
        body: body,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            'activity',
            'Interests and messages',
            channelDescription: 'New interests, connections and messages',
            importance: Importance.high,
            priority: Priority.high,
            color: Color(0xFFF26076),
          ),
          iOS: DarwinNotificationDetails(),
        ),
        payload: link,
      );
    } catch (_) {}
  }
}

/// Opens the phone's share sheet for a file (invoice PDF, data export), so the
/// member can save it to Files/Drive or send it.
Future<void> shareFile(Uint8List bytes, String name, String mime) async {
  await SharePlus.instance.share(ShareParams(
    files: [XFile.fromData(bytes, mimeType: mime, name: name)],
    fileNameOverrides: [name],
  ));
}
