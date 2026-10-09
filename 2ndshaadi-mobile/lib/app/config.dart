import 'package:flutter/foundation.dart';

/// Build-time settings. Override with --dart-define, for example:
///   flutter build apk --dart-define=API_URL=https://2ndshadi.com
class AppConfig {
  AppConfig._();

  static const String _apiUrl = String.fromEnvironment('API_URL');

  /// Test builds only (--dart-define=DEV_TOOLS=true): the server address can be
  /// changed in the app (long-press the logo on the welcome screen), e.g. to a
  /// computer on the same Wi-Fi running the API.
  static const bool devTools = bool.fromEnvironment('DEV_TOOLS');
  static String? serverOverride;
  static const bool _iosPurchases = bool.fromEnvironment('IOS_PURCHASES');

  /// Where the 2ndShaadi API lives (scheme + host, no path).
  static String get apiOrigin {
    final o = serverOverride;
    if (devTools && o != null && o.isNotEmpty) return o.replaceAll(RegExp(r'/+$'), '');
    if (_apiUrl.isNotEmpty) return _apiUrl.replaceAll(RegExp(r'/+$'), '');
    // The web build is only a preview, served next to the API.
    if (kIsWeb) return Uri.base.origin;
    if (kReleaseMode) return 'https://2ndshadi.com';
    // Android emulator reaches the computer's localhost at 10.0.2.2.
    return defaultTargetPlatform == TargetPlatform.android ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
  }

  static String get apiBase => '$apiOrigin/api/v1';

  /// Paid plans are bought in the app on Android (Razorpay). Apple requires its
  /// own in-app purchase for memberships, so iOS only shows the member's plan
  /// unless IOS_PURCHASES is switched on.
  static bool get canBuyInApp {
    if (kIsWeb) return true;
    if (defaultTargetPlatform == TargetPlatform.iOS) return _iosPurchases;
    return true;
  }

  static const String appName = '2ndShaadi';
}
