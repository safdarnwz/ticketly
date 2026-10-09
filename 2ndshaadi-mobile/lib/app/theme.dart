import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Colours from the web app (frontend/src/styles/index.css).
class C {
  C._();
  static const paper = Color(0xFFF2F2F2);
  static const surface = Color(0xFFFFFFFF);
  static const sunk = Color(0xFFEBEBEB);
  static const soft = Color(0xFFF7F7F7);
  static const ink = Color(0xFF1C1C1E);
  static const ink2 = Color(0xFF55555A);
  static const ink3 = Color(0xFF85858B);
  static const line = Color(0xFFE3E3E3);
  static const lineStrong = Color(0xFFD0D0D0);
  static const button = Color(0xFFF26076);
  static const buttonPressed = Color(0xFFE84A63);
  static const brand = Color(0xFFC8304D);
  static const brandSoft = Color(0xFFFDE6EA);
  static const coral = Color(0xFFEF5667);
  static const gold = Color(0xFFA86D0C);
  static const goldSoft = Color(0xFFFBF1D9);
  static const ok = Color(0xFF2F7A4F);
  static const okSoft = Color(0xFFE4F2E7);
  static const danger = Color(0xFFC93A3A);
  static const dangerSoft = Color(0xFFFDEAEA);
  static const warnSoft = Color(0xFFFDF3DC);
  static const announce = Color(0xFFF2842F);
}

/// Spacing and corner radii used everywhere, so screens line up.
class S {
  S._();
  static const gutter = 16.0;
  static const radius = 14.0;
  static const radiusSmall = 10.0;
  static const maxContent = 720.0;
}

ThemeData buildTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: C.button,
    onPrimary: Colors.white,
    primaryContainer: C.brandSoft,
    onPrimaryContainer: C.brand,
    secondary: C.brand,
    onSecondary: Colors.white,
    secondaryContainer: C.brandSoft,
    onSecondaryContainer: C.brand,
    tertiary: C.gold,
    onTertiary: Colors.white,
    error: C.danger,
    onError: Colors.white,
    surface: C.surface,
    onSurface: C.ink,
    onSurfaceVariant: C.ink2,
    surfaceContainerLowest: C.surface,
    surfaceContainerLow: C.soft,
    surfaceContainer: C.paper,
    surfaceContainerHigh: C.sunk,
    surfaceContainerHighest: C.sunk,
    outline: C.lineStrong,
    outlineVariant: C.line,
  );

  final base = ThemeData(useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: C.paper);
  final text = base.textTheme.apply(bodyColor: C.ink, displayColor: C.ink);
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  const minSize = Size(64, 48);

  return base.copyWith(
    textTheme: text.copyWith(
      headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w600, fontSize: 22),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 19),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600, fontSize: 16),
      titleSmall: text.titleSmall?.copyWith(fontWeight: FontWeight.w600, fontSize: 14),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 15.5, height: 1.45, letterSpacing: 0.1),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 14.5, height: 1.4, color: C.ink2, letterSpacing: 0.1),
      bodySmall: text.bodySmall?.copyWith(fontSize: 12.5, color: C.ink3, letterSpacing: 0.1),
      labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 15),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: C.paper,
      foregroundColor: C.ink,
      elevation: 0,
      // No colour change while scrolling: nothing flickers under the bar.
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: TextStyle(color: C.ink, fontSize: 19, fontWeight: FontWeight.w600),
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.button,
        foregroundColor: Colors.white,
        disabledBackgroundColor: C.button.withValues(alpha: 0.45),
        disabledForegroundColor: Colors.white,
        minimumSize: minSize,
        shape: rounded,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: C.ink,
        minimumSize: minSize,
        shape: rounded,
        side: const BorderSide(color: C.lineStrong),
        backgroundColor: C.surface,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: C.brand,
        minimumSize: const Size(48, 44),
        textStyle: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: C.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: const TextStyle(color: C.ink3),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: C.lineStrong)),
      enabledBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: C.lineStrong)),
      focusedBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: C.brand, width: 1.6)),
      errorBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: C.danger)),
      focusedErrorBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: C.danger, width: 1.6)),
      disabledBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: C.line)),
    ),
    cardTheme: CardThemeData(
      color: C.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(S.radius), side: const BorderSide(color: C.line)),
    ),
    dividerTheme: const DividerThemeData(color: C.line, thickness: 1, space: 1),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: C.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 64,
      indicatorColor: C.brandSoft,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontSize: 12,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500,
          color: s.contains(WidgetState.selected) ? C.brand : C.ink3,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? C.brand : C.ink3),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: C.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: C.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: C.ink,
      actionTextColor: const Color(0xFFFFB3C0),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: C.surface,
      selectedColor: C.ink,
      side: const BorderSide(color: C.lineStrong),
      labelStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: C.ink2),
      secondaryLabelStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Colors.white),
      checkmarkColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.all(Colors.white),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? C.button : C.lineStrong),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: C.button),
    tabBarTheme: const TabBarThemeData(
      labelColor: C.ink,
      unselectedLabelColor: C.ink3,
      indicatorColor: C.button,
      dividerColor: C.line,
      labelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5),
      unselectedLabelStyle: TextStyle(fontWeight: FontWeight.w500, fontSize: 14.5),
    ),
    listTileTheme: const ListTileThemeData(iconColor: C.ink2, contentPadding: EdgeInsets.symmetric(horizontal: 16)),
    splashFactory: InkRipple.splashFactory,
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
  );
}
