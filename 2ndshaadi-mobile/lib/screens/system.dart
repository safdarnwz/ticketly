import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../core/session.dart';
import '../widgets/common.dart';
import '../widgets/photo.dart';

/// First frame while the session is restored: the logo, nothing that jumps.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: C.paper,
        body: Center(child: LogoMark(size: 72)),
      );
}

/// The server could not be reached after several tries. The member stays signed in.
class UnreachableScreen extends ConsumerStatefulWidget {
  const UnreachableScreen({super.key});
  @override
  ConsumerState<UnreachableScreen> createState() => _UnreachableScreenState();
}

class _UnreachableScreenState extends ConsumerState<UnreachableScreen> {
  bool busy = false;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.wifi_off_rounded, size: 52, color: C.brand),
                const SizedBox(height: 16),
                Text('We cannot reach 2ndShaadi right now', textAlign: TextAlign.center, style: t.titleLarge),
                const SizedBox(height: 8),
                Text(
                  'Please check your internet connection. If it is working, our service may be restarting. Try again in a minute — you are still signed in.',
                  textAlign: TextAlign.center,
                  style: t.bodyLarge?.copyWith(color: C.ink2),
                ),
                const SizedBox(height: 22),
                AppButton(
                  label: 'Try again',
                  icon: Icons.refresh_rounded,
                  loading: busy,
                  onPressed: () async {
                    setState(() => busy = true);
                    await ref.read(sessionProvider.notifier).boot();
                    if (mounted) setState(() => busy = false);
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class MaintenanceScreen extends ConsumerWidget {
  const MaintenanceScreen({super.key, required this.site});
  final SiteConfig site;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const LogoMark(size: 64),
                const SizedBox(height: 20),
                Text(site.maintenanceTitle, textAlign: TextAlign.center, style: t.headlineSmall),
                const SizedBox(height: 10),
                Text(site.maintenanceMessage, textAlign: TextAlign.center, style: t.bodyLarge?.copyWith(color: C.ink2)),
                const SizedBox(height: 24),
                AppButton(
                  label: 'Check again',
                  variant: ButtonVariant.secondary,
                  icon: Icons.refresh_rounded,
                  onPressed: () => ref.invalidate(siteProvider),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(),
        body: EmptyState(
          icon: Icons.search_off_rounded,
          title: 'This page does not exist',
          body: 'The link may be old or mistyped.',
          action: AppButton(label: 'Go home', onPressed: () => context.go('/discover')),
        ),
      );
}
