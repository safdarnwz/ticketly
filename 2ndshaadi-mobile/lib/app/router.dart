import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/session.dart';
import '../core/tracker.dart';
import '../screens/account/account_hub.dart';
import '../screens/account/lists.dart';
import '../screens/auth/login.dart';
import '../screens/auth/welcome.dart';
import '../screens/chats/chats.dart';
import '../screens/chats/thread.dart';
import '../screens/content/content_page.dart';
import '../screens/content/grievance.dart';
import '../screens/content/help.dart';
import '../screens/discover/discover.dart';
import '../screens/interests.dart';
import '../screens/me/edit_profile.dart';
import '../screens/me/preferences.dart';
import '../screens/notifications.dart';
import '../screens/plans/plans.dart';
import '../screens/profile/profile_view.dart';
import '../screens/settings/settings.dart';
import '../screens/shell.dart';
import '../screens/system.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');
final messengerKey = GlobalKey<ScaffoldMessengerState>();

/// Screens a signed-out visitor may open.
bool _guestAllowed(String loc) =>
    loc == '/welcome' || loc == '/login' || loc == '/help' || loc == '/grievance' || loc.startsWith('/page/');

const _authOnly = {'/splash', '/offline', '/welcome', '/login'};

final routerProvider = Provider<GoRouter>((ref) {
  final status = ValueNotifier<SessionStatus>(ref.read(sessionProvider).status);
  ref.listen(sessionProvider.select((s) => s.status), (_, next) => status.value = next);
  ref.onDispose(status.dispose);

  final router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: status,
    redirect: (context, state) {
      final loc = state.matchedLocation;
      switch (status.value) {
        case SessionStatus.loading:
          return loc == '/splash' ? null : '/splash';
        case SessionStatus.unreachable:
          return loc == '/offline' ? null : '/offline';
        case SessionStatus.guest:
          return _guestAllowed(loc) ? null : '/welcome';
        case SessionStatus.member:
          return _authOnly.contains(loc) ? '/discover' : null;
      }
    },
    errorBuilder: (context, state) => const NotFoundScreen(),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/offline', builder: (_, _) => const UnreachableScreen()),
      GoRoute(path: '/welcome', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => MemberShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/discover',
              builder: (_, s) => DiscoverScreen(openSaved: s.uri.queryParameters['saved'] == '1'),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/interests', builder: (_, s) => InterestsScreen(tab: s.uri.queryParameters['tab'])),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/chats', builder: (_, _) => const ChatsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/alerts', builder: (_, _) => const NotificationsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (_, _) => const AccountHub())]),
        ],
      ),
      GoRoute(path: '/profile/:id', builder: (_, s) => ProfileScreen(userId: s.pathParameters['id'] ?? '')),
      GoRoute(path: '/chat/:peerId', builder: (_, s) => ThreadScreen(peerId: s.pathParameters['peerId'] ?? '')),
      GoRoute(
        path: '/edit-profile',
        builder: (_, s) => EditProfileScreen(welcome: s.uri.queryParameters['welcome'] == '1'),
      ),
      GoRoute(path: '/preferences', builder: (_, _) => const PreferencesScreen()),
      GoRoute(path: '/shortlist', builder: (_, s) => ShortlistScreen(showMe: s.uri.queryParameters['view'] == 'me')),
      GoRoute(path: '/visitors', builder: (_, _) => const VisitorsScreen()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(path: '/plans', builder: (_, s) => PlansScreen(planCode: s.uri.queryParameters['plan'])),
      GoRoute(path: '/page/:slug', builder: (_, s) => ContentPageScreen(slug: s.pathParameters['slug'] ?? '')),
      GoRoute(path: '/help', builder: (_, _) => const HelpScreen()),
      GoRoute(path: '/grievance', builder: (_, _) => const GrievanceScreen()),
    ],
  );

  // Screen views for the admin analytics page.
  void track() {
    try {
      final path = router.routeInformationProvider.value.uri.path;
      if (!_authOnly.contains(path) || path == '/welcome' || path == '/login') Tracker.instance.page(path);
    } catch (_) {}
  }

  router.routeInformationProvider.addListener(track);
  ref.onDispose(() {
    router.routeInformationProvider.removeListener(track);
    router.dispose();
  });
  return router;
});
