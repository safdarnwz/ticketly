import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../core/session.dart';
import 'common.dart';
import 'photo.dart';

const photoLockText = {
  'CONNECTIONS_ONLY': 'Photos for connections',
  'PAID_ONLY': 'Photos for paid members',
  'PLAN_LIMIT': 'More photos with a paid plan',
};

/// Name, age, premium tick and plan badge on one line that never overflows.
class NameLine extends StatelessWidget {
  const NameLine({super.key, required this.name, this.age, this.premium = false, this.badge, this.style, this.tick = 16});
  final String name;
  final int? age;
  final bool premium;
  final PlanBadgeInfo? badge;
  final TextStyle? style;
  final double tick;
  @override
  Widget build(BuildContext context) {
    final s = style ?? const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: C.ink);
    return Row(
      children: [
        Flexible(
          child: Text.rich(
            TextSpan(children: [
              TextSpan(text: name),
              if (age != null) TextSpan(text: ', $age', style: const TextStyle(color: C.ink3, fontWeight: FontWeight.w500)),
            ]),
            style: s,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (premium) ...[const SizedBox(width: 4), PremiumTick(size: tick)],
        if (badge != null) ...[const SizedBox(width: 5), PlanBadge(badge)],
      ],
    );
  }
}

/// A member as a list row (phones): photo, name, place, match.
class MemberRow extends StatelessWidget {
  const MemberRow({super.key, required this.p, this.trailing, this.subtitle, this.onTap});
  final MemberCard p;
  final Widget? trailing;
  final String? subtitle;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final place = [p.city, if (p.maritalStatus != null) marital[p.maritalStatus] ?? p.maritalStatus].whereType<String>().join(' · ');
    return Material(
      color: C.surface,
      borderRadius: BorderRadius.circular(S.radius),
      child: InkWell(
        borderRadius: BorderRadius.circular(S.radius),
        onTap: onTap ?? () => context.push('/profile/${p.userId}'),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: C.line),
            borderRadius: BorderRadius.circular(S.radius),
          ),
          child: Row(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Photo(url: p.photo, name: p.name, size: 68, radius: BorderRadius.circular(12)),
                  if (p.online)
                    Positioned(
                      right: -2,
                      top: -2,
                      child: Container(
                        width: 13,
                        height: 13,
                        decoration: BoxDecoration(
                            color: C.ok, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    NameLine(name: p.name, age: p.age, premium: p.premium, badge: p.planBadge),
                    const SizedBox(height: 2),
                    Text(subtitle ?? (place.isEmpty ? 'India' : place),
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: C.ink2)),
                    if (p.profession != null)
                      Text(p.profession!,
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: C.ink3)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (p.matchScore != null) MatchChip(p.matchScore!),
                        if (p.isNew) const Pill('New', tone: PillTone.dark),
                        if (p.connected) const Pill('Connected', tone: PillTone.love),
                        if (p.photo == null && p.photoLock != null)
                          Pill(photoLockText[p.photoLock] ?? 'Photos locked', icon: Icons.lock_rounded),
                      ],
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 6), trailing!],
            ],
          ),
        ),
      ),
    );
  }
}

/// A member as a photo card (tablets and the shortlist grid).
class MemberTile extends StatelessWidget {
  const MemberTile({super.key, required this.p, this.onToggleShortlist, this.onHide});
  final MemberCard p;
  final VoidCallback? onToggleShortlist;
  final VoidCallback? onHide;
  @override
  Widget build(BuildContext context) {
    return Material(
      color: C.surface,
      borderRadius: BorderRadius.circular(S.radius),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/profile/${p.userId}'),
        child: DecoratedBox(
          decoration: BoxDecoration(border: Border.all(color: C.line), borderRadius: BorderRadius.circular(S.radius)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: 4 / 5,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Photo(url: p.photo, name: p.name, radius: BorderRadius.zero),
                    if (p.isNew) const Positioned(left: 8, top: 8, child: Pill('New', tone: PillTone.dark)),
                    if (p.photo == null && p.photoLock != null)
                      Positioned(
                        left: 8,
                        right: 8,
                        bottom: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 6),
                          decoration: BoxDecoration(color: C.surface, borderRadius: BorderRadius.circular(8)),
                          child: Text(photoLockText[p.photoLock] ?? '',
                              textAlign: TextAlign.center,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: C.ink2)),
                        ),
                      ),
                    Positioned(
                      right: 2,
                      top: 2,
                      child: Column(
                        children: [
                          if (onToggleShortlist != null)
                            _OverlayIcon(
                              icon: p.shortlisted ? Icons.star_rounded : Icons.star_outline_rounded,
                              color: p.shortlisted ? const Color(0xFFF5C044) : Colors.white,
                              label: p.shortlisted ? 'Remove from shortlist' : 'Shortlist',
                              onTap: onToggleShortlist!,
                            ),
                          if (onHide != null)
                            _OverlayIcon(icon: Icons.visibility_off_outlined, label: 'Not interested', onTap: onHide!),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    NameLine(name: p.name, age: p.age, premium: p.premium, badge: null, tick: 14),
                    Text(
                      [p.city, if (p.maritalStatus != null) marital[p.maritalStatus]].whereType<String>().join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, color: C.ink2),
                    ),
                    if (p.matchScore != null) ...[const SizedBox(height: 6), MatchChip(p.matchScore!)],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OverlayIcon extends StatelessWidget {
  const _OverlayIcon({required this.icon, required this.label, required this.onTap, this.color = Colors.white});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;
  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: label,
        onPressed: onTap,
        icon: Icon(icon, color: color, shadows: const [Shadow(blurRadius: 6, color: Colors.black54)]),
      );
}

/// Grid on tablets, list on phones.
int gridColumns(double width) => width >= 1100 ? 4 : width >= 820 ? 3 : 2;

/// Account states the member must know about: deletion pending, chat switched off.
class AccountNotices extends ConsumerStatefulWidget {
  const AccountNotices({super.key, this.showChatBan = true});
  final bool showChatBan;
  @override
  ConsumerState<AccountNotices> createState() => _AccountNoticesState();
}

class _AccountNoticesState extends ConsumerState<AccountNotices> {
  bool busy = false;
  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    if (me == null) return const SizedBox.shrink();
    final children = <Widget>[];
    if (me.deletionScheduledFor != null) {
      children.add(Notice(
        'Your account will be deleted on ${date(me.deletionScheduledFor)}. Your profile is hidden until then.',
        tone: PillTone.danger,
        icon: Icons.delete_outline_rounded,
        action: AppButton(
          label: 'Keep my account',
          variant: ButtonVariant.secondary,
          dense: true,
          loading: busy,
          onPressed: () async {
            setState(() => busy = true);
            final ok = await runGuarded(context, () async => Api.instance.delete('/users/me/deletion'));
            await ref.read(sessionProvider.notifier).reloadMe();
            if (!mounted) return;
            setState(() => busy = false);
            if (ok && context.mounted) toast(context, 'Your account is staying. Welcome back!');
          },
        ),
      ));
    }
    if (widget.showChatBan && me.chatBanned) {
      children.add(Notice(
        '${sentence(me.chatBanReason)} Our team reviews every case within 24 hours. Contact details may only be shared through 2ndShaadi, and never ask anyone for money or bank details.',
        title: 'Chat is switched off on your account',
        tone: PillTone.danger,
        icon: Icons.block_rounded,
      ));
    }
    if (children.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(children: [for (final c in children) Padding(padding: const EdgeInsets.only(bottom: 8), child: c)]),
    );
  }
}
