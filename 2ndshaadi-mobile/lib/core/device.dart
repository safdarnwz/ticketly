import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Short description of this phone, sent as the User-Agent so the member's
/// "Where you're signed in" list and the admin analytics can name it:
///   2ndShaadiApp/1.0.0 (Android 15; SM-S918B; mobile)
class DeviceInfo {
  DeviceInfo._();
  static String userAgent = '2ndShaadiApp/1.0.0 (Android 0; unknown; mobile)';
  static String appVersion = '1.0.0';

  static Future<void> init() async {
    if (kIsWeb) return;
    try {
      final pkg = await PackageInfo.fromPlatform();
      appVersion = pkg.version;
    } catch (_) {}
    final view = WidgetsBinding.instance.platformDispatcher.views.firstOrNull;
    final shortest = view == null ? 0.0 : (view.physicalSize / view.devicePixelRatio).shortestSide;
    final kind = shortest >= 600 ? 'tablet' : 'mobile';
    try {
      final info = DeviceInfoPlugin();
      if (defaultTargetPlatform == TargetPlatform.android) {
        final a = await info.androidInfo;
        userAgent = '2ndShaadiApp/$appVersion (Android ${_clean(a.version.release)}; ${_clean(a.model)}; $kind)';
      } else if (defaultTargetPlatform == TargetPlatform.iOS) {
        final i = await info.iosInfo;
        final os = kind == 'tablet' ? 'iPadOS' : 'iOS';
        userAgent = '2ndShaadiApp/$appVersion ($os ${_clean(i.systemVersion)}; ${_clean(i.utsname.machine)}; $kind)';
      }
    } catch (_) {
      // Keep the generic description.
    }
  }

  static String _clean(String s) => s.replaceAll(RegExp(r'[^\w .,\-]'), '').trim();
}
