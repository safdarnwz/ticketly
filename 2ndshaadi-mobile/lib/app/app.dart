import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/local_notify.dart';
import '../core/providers.dart';
import '../core/realtime.dart';
import '../core/session.dart';
import '../core/tracker.dart';
import '../screens/system.dart';
import '../widgets/upgrade.dart';
import 'links.dart';
import 'router.dart';
import 'theme.dart';

class App extends ConsumerStatefulWidget {
  const App({super.key});
  @override
  ConsumerState<App> createState() => _AppState();
}

class _AppState extends ConsumerState<App> with WidgetsBindingObserver {
  final _subs = <StreamSubscription<dynamic>>[];
  bool _upgradeOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Tracker.instance.resumed();

    final rt = Realtime.instance;
    LocalNotify.instance.onOpen = (link) {
      final c = rootNavigatorKey.currentContext;
      if (c != null && link != null) openLink(c, link);
    };
    LocalNotify.instance.init();
    // Live updates while signed in.
    ref.listenManual(meProvider.select((m) => m?.id), (_, id) {
      if (id == null) {
        Realtime.instance.disconnect();
      } else {
        Realtime.instance.connect(id);
        // Ask for notification permission once the member is signed in (Android 13+, iOS).
        Future.delayed(const Duration(seconds: 3), LocalNotify.instance.request);
      }
    }, fireImmediately: true);

    _subs.add(Api.instance.upgradeRequired.listen(_showUpgrade));
    _subs.add(rt.notifications.listen((n) {
      ref.invalidate(countsProvider);
      ref.invalidate(notificationsProvider);
      if (n.type == 'INTEREST_RECEIVED' || n.type == 'INTEREST_ACCEPTED') ref.invalidate(interestsProvider);
      if (n.type == 'PLAN_ACTIVATED') ref.read(sessionProvider.notifier).reloadMe();
      if (!_foreground) {
        LocalNotify.instance.show(n.title, n.body, link: n.link);
        return;
      }
      final m = messengerKey.currentState;
      if (m != null && n.title.isNotEmpty) {
        m.hideCurrentSnackBar();
        m.showSnackBar(SnackBar(
          content: Text(n.title),
          action: n.link == null
              ? null
              : SnackBarAction(label: 'Open', onPressed: () {
                  final c = rootNavigatorKey.currentContext;
                  if (c != null) openLink(c, n.link);
                }),
        ));
      }
    }));
    _subs.add(rt.messages.listen((m) {
      ref.invalidate(conversationsProvider);
      if (m.senderId != rt.myId) {
        ref.invalidate(countsProvider);
        if (!_foreground) {
          final body = m.body.length > 80 ? '${m.body.substring(0, 80)}…' : m.body;
          LocalNotify.instance.show('New message', body, link: '/messages/${m.senderId}');
        }
      }
    }));
    _subs.add(rt.connections.listen((_) {
      ref.invalidate(interestsProvider);
      ref.invalidate(conversationsProvider);
    }));
  }

  void _showUpgrade(UpgradeEvent e) {
    final c = rootNavigatorKey.currentContext;
    if (c == null || _upgradeOpen) return;
    _upgradeOpen = true;
    showUpgradeSheet(c, e).whenComplete(() => _upgradeOpen = false);
  }

  bool get _foreground => WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      Tracker.instance.resumed();
      ref.read(sessionProvider.notifier).resume();
      Realtime.instance.resume();
      if (ref.read(sessionProvider).status == SessionStatus.member) ref.invalidate(countsProvider);
    } else if (state == AppLifecycleState.paused) {
      Tracker.instance.paused();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: '2ndShaadi',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: router,
      scaffoldMessengerKey: messengerKey,
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        // Respect the phone's text size, within limits that keep every layout intact.
        final scaler = mq.textScaler.clamp(minScaleFactor: 0.9, maxScaleFactor: 1.3);
        return MediaQuery(
          data: mq.copyWith(textScaler: scaler),
          child: _Gate(child: child ?? const SizedBox.shrink()),
        );
      },
    );
  }
}

/// Maintenance page over everything, and a slim banner while offline.
class _Gate extends ConsumerStatefulWidget {
  const _Gate({required this.child});
  final Widget child;
  @override
  ConsumerState<_Gate> createState() => _GateState();
}

class _GateState extends ConsumerState<_Gate> {
  StreamSubscription<List<ConnectivityResult>>? _sub;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    try {
      _sub = Connectivity().onConnectivityChanged.listen((r) {
        final off = r.isEmpty || r.every((x) => x == ConnectivityResult.none);
        if (off != _offline && mounted) setState(() => _offline = off);
        if (!off) {
          // Back online: refresh what is on screen.
          ref.invalidate(countsProvider);
          Realtime.instance.resume();
        }
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final site = ref.watch(siteConfigProvider);
    if (site.maintenance) return MaintenanceScreen(site: site);
    return Column(
      children: [
        Expanded(child: widget.child),
        AnimatedSize(
          duration: const Duration(milliseconds: 180),
          child: _offline
              ? Material(
                  color: C.ink,
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        children: const [
                          Icon(Icons.wifi_off_rounded, color: Colors.white, size: 18),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text('You are offline. We will update when you are back.',
                                style: TextStyle(color: Colors.white, fontSize: 13)),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}
