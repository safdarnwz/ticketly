import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'app/config.dart';
import 'app/theme.dart';
import 'core/api.dart';
import 'core/device.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Errors are logged, never shown as a red screen or a crash.
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('Uncaught: $error\n$stack');
    return true;
  };
  ErrorWidget.builder = (details) {
    if (kDebugMode) return ErrorWidget(details.exception);
    return const _QuietError();
  };

  await DeviceInfo.init();
  if (AppConfig.devTools) {
    try {
      AppConfig.serverOverride = (await SharedPreferences.getInstance()).getString('dev_server');
    } catch (_) {}
  }

  // Draw behind the status and navigation bars (Android 15+ style); screens use SafeArea.
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  // Phones stay upright; tablets may rotate.
  final view = PlatformDispatcher.instance.views.firstOrNull;
  final shortest = view == null ? 0.0 : (view.physicalSize / view.devicePixelRatio).shortestSide;
  if (shortest > 0 && shortest < 600) {
    await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  }

  runApp(ProviderScope(
    // Retry a failed load twice when it was the network, never for real errors.
    retry: (count, error) =>
        error is ApiError && error.isNetwork && count < 2 ? Duration(milliseconds: 800 * (count + 1)) : null,
    child: const App(),
  ));
}

/// What a broken widget shows in release builds: a calm blank space.
class _QuietError extends StatelessWidget {
  const _QuietError();
  @override
  Widget build(BuildContext context) => const ColoredBox(
        color: C.paper,
        child: Center(child: Icon(Icons.image_not_supported_outlined, color: C.ink3)),
      );
}
