import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/device.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/member.dart';
import '../../widgets/photo.dart';

/// The "Profile" tab: who you are, and everything about your account.
class AccountHub extends ConsumerWidget {
  const AccountHub({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    if (me == null) return const Scaffold();
    final t = Theme.of(context).textTheme;
    Widget item(IconData icon, String label, String route, {String? sub}) => ListTile(
          leading: Icon(icon, color: C.ink2),
          title: Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
          subtitle: sub == null ? null : Text(sub, style: const TextStyle(fontSize: 12.5, color: C.ink3)),
          trailing: const Icon(Icons.chevron_right_rounded, color: C.ink3),
          onTap: () => context.push(route),
        );

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 24),
        children: [
          ContentWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const AccountNotices(),
                Material(
                  color: C.brandSoft,
                  borderRadius: BorderRadius.circular(18),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(18),
                    onTap: () => context.push('/edit-profile'),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(3),
                            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                            child: Photo(url: me.photo, name: me.displayName, size: 72),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                NameLine(
                                  name: me.name.isEmpty ? me.displayName : me.name,
                                  premium: me.isPaid && me.features.premiumBadge,
                                  badge: me.planBadge,
                                  style: t.titleLarge,
                                ),
                                GestureDetector(
                                  onTap: () {
                                    Clipboard.setData(ClipboardData(text: me.profileId));
                                    toast(context, 'Profile ID copied');
                                  },
                                  child: Text('ID ${me.profileId}',
                                      style: const TextStyle(fontSize: 12.5, color: C.ink2, fontWeight: FontWeight.w600)),
                                ),
                                const SizedBox(height: 2),
                                Text('Others see you as ${me.displayName}', style: const TextStyle(fontSize: 13, color: C.ink2)),
                                const SizedBox(height: 8),
                                Wrap(spacing: 6, runSpacing: 4, children: [
                                  Pill(me.profileComplete ? 'Profile complete' : '${me.completionPercent}% complete',
                                      tone: me.profileComplete ? PillTone.ok : PillTone.gold),
                                  if (me.isHidden) const Pill('Hidden from search'),
                                  Pill(me.planName, tone: me.isPaid ? PillTone.gold : PillTone.neutral),
                                ]),
                              ],
                            ),
                          ),
                          const Icon(Icons.edit_outlined, color: C.brand),
                        ],
                      ),
                    ),
                  ),
                ),
                const GroupLabel('My profile'),
                _Card(children: [
                  item(Icons.person_outline_rounded, 'Edit my profile', '/edit-profile', sub: 'Photos, details, about you'),
                  item(Icons.tune_rounded, 'Partner preferences', '/preferences', sub: 'Who you would like to meet'),
                ]),
                const GroupLabel('People'),
                _Card(children: [
                  item(Icons.star_outline_rounded, 'Shortlist', '/shortlist'),
                  item(Icons.visibility_outlined, 'Who viewed me', '/visitors'),
                ]),
                const GroupLabel('Account'),
                _Card(children: [
                  item(Icons.workspace_premium_outlined, 'Membership plans', '/plans',
                      sub: me.isPaid ? '${me.planName} member' : 'Free plan'),
                  item(Icons.settings_outlined, 'Settings and privacy', '/settings'),
                  item(Icons.help_outline_rounded, 'Help, safety and policies', '/help'),
                ]),
                const SizedBox(height: 18),
                AppButton(
                  label: 'Log out',
                  icon: Icons.logout_rounded,
                  variant: ButtonVariant.secondary,
                  onPressed: () async {
                    if (await confirm(context, title: 'Log out of 2ndShaadi?', yes: 'Log out')) {
                      await ref.read(sessionProvider.notifier).signOut();
                    }
                  },
                ),
                const SizedBox(height: 14),
                Center(
                  child: Text('2ndShaadi app ${DeviceInfo.appVersion}', style: const TextStyle(fontSize: 12, color: C.ink3)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(S.radius)),
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          for (var i = 0; i < children.length; i++) ...[if (i > 0) const Divider(indent: 56), children[i]],
        ]),
      );
}
