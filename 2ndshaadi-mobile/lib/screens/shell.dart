import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../core/providers.dart';
import '../widgets/common.dart';

/// Bottom bar on phones, side rail on tablets. Each tab keeps its own scroll
/// position and stack while you switch.
class MemberShell extends ConsumerWidget {
  const MemberShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  void _go(int i) {
    if (i == shell.currentIndex) {
      // Tapping the open tab again returns to its first screen.
      shell.goBranch(i, initialLocation: true);
    } else {
      HapticFeedback.selectionClick();
      shell.goBranch(i);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counts = ref.watch(countsProvider).value ?? Counts.zero;
    final items = [
      (Icons.home_outlined, Icons.home_rounded, 'Discover', 0),
      (Icons.favorite_border_rounded, Icons.favorite_rounded, 'Interests', counts.interests),
      (Icons.chat_bubble_outline_rounded, Icons.chat_bubble_rounded, 'Chats', counts.messages),
      (Icons.notifications_none_rounded, Icons.notifications_rounded, 'Alerts', counts.notifications),
      (Icons.person_outline_rounded, Icons.person_rounded, 'Profile', 0),
    ];
    final wide = MediaQuery.sizeOf(context).width >= 720;

    // Back on another tab goes to Discover first; back on Discover leaves the app.
    return PopScope(
      canPop: shell.currentIndex == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) shell.goBranch(0);
      },
      child: wide
          ? Scaffold(
              body: Row(
                children: [
                  SafeArea(
                    right: false,
                    child: NavigationRail(
                      selectedIndex: shell.currentIndex,
                      onDestinationSelected: _go,
                      labelType: NavigationRailLabelType.all,
                      backgroundColor: C.surface,
                      indicatorColor: C.brandSoft,
                      selectedIconTheme: const IconThemeData(color: C.brand),
                      selectedLabelTextStyle: const TextStyle(color: C.brand, fontWeight: FontWeight.w600, fontSize: 12),
                      unselectedLabelTextStyle: const TextStyle(color: C.ink3, fontSize: 12),
                      destinations: [
                        for (final (icon, active, label, n) in items)
                          NavigationRailDestination(
                            icon: CountBadge(n, child: Icon(icon)),
                            selectedIcon: CountBadge(n, child: Icon(active)),
                            label: Text(label),
                          ),
                      ],
                    ),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: shell),
                ],
              ),
            )
          : Scaffold(
              body: shell,
              bottomNavigationBar: DecoratedBox(
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
                child: NavigationBar(
                  selectedIndex: shell.currentIndex,
                  onDestinationSelected: _go,
                  labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
                  destinations: [
                    for (final (icon, active, label, n) in items)
                      NavigationDestination(
                        icon: CountBadge(n, child: Icon(icon)),
                        selectedIcon: CountBadge(n, child: Icon(active)),
                        label: label,
                        tooltip: '',
                      ),
                  ],
                ),
              ),
            ),
    );
  }
}
