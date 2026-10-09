import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/links.dart';
import '../../app/theme.dart';
import '../../core/actions.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/member.dart';
import '../../widgets/photo.dart';
import '../../widgets/report_block.dart';
import 'photo_viewer.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key, required this.userId});
  final String userId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    if (me != null && userId == me.id) {
      return Scaffold(
        appBar: AppBar(),
        body: EmptyState(
          icon: Icons.person_rounded,
          title: 'This is your profile',
          action: AppButton(label: 'Edit my profile', onPressed: () => context.pushReplacement('/edit-profile')),
        ),
      );
    }
    final data = ref.watch(profileProvider(userId));
    return Scaffold(
      appBar: AppBar(
        title: Text(data.value?.card.firstName ?? ''),
        actions: [if (data.value != null) _MoreMenu(p: data.value!)],
      ),
      body: data.when(
        skipLoadingOnRefresh: true,
        loading: () => const _ProfileSkeleton(),
        error: (e, _) => _ProfileError(error: e, onRetry: () => ref.invalidate(profileProvider(userId))),
        data: (p) => RefreshIndicator(
          onRefresh: () => ref.refresh(profileProvider(userId).future).then((_) {}, onError: (_) {}),
          child: _ProfileBody(p: p),
        ),
      ),
    );
  }
}

class _ProfileError extends StatelessWidget {
  const _ProfileError({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final e = error;
    if (e is ApiError && e.code == 'DAILY_LIMIT') {
      return EmptyState(
        icon: Icons.hourglass_bottom_rounded,
        title: 'You have reached today’s profile limit',
        body: e.message,
        action: AppButton(label: 'See plans', onPressed: () => context.push('/plans')),
      );
    }
    if (e is ApiError && e.status == 402) {
      return EmptyState(
        icon: Icons.workspace_premium_outlined,
        title: 'This profile is for paid members',
        body: e.message,
        action: AppButton(label: 'See plans', onPressed: () => context.push('/plans')),
      );
    }
    if (e is ApiError && e.status == 404) {
      return EmptyState(
        icon: Icons.person_off_outlined,
        title: 'This profile is not available',
        body: 'The member may have hidden or closed their profile.',
        action: AppButton(label: 'Back', variant: ButtonVariant.secondary, onPressed: () => context.pop()),
      );
    }
    return ErrorState(error: e, onRetry: onRetry);
  }
}

class _ProfileSkeleton extends StatelessWidget {
  const _ProfileSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(S.gutter),
        children: const [
          AspectRatio(aspectRatio: 4 / 5, child: Skeleton(radius: 18)),
          SizedBox(height: 16),
          Skeleton(height: 26, width: 220),
          SizedBox(height: 10),
          Skeleton(height: 16, width: 160),
          SizedBox(height: 16),
          Skeleton(height: 120, radius: 14),
        ],
      );
}

class _MoreMenu extends ConsumerWidget {
  const _MoreMenu({required this.p});
  final FullProfile p;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = p.card;
    return PopupMenuButton<String>(
      tooltip: 'More',
      icon: const Icon(Icons.more_vert_rounded),
      onSelected: (v) async {
        switch (v) {
          case 'ignore':
            await setIgnored(context, ref, c.userId, !p.ignored);
          case 'report':
            final blocked = await showReportSheet(context, userId: c.userId, name: c.name);
            if (blocked == true && context.mounted) context.pop();
          case 'block':
            if (await blockMember(context, ref, userId: c.userId, name: c.name) && context.mounted) context.pop();
          case 'copy':
            await Clipboard.setData(ClipboardData(text: c.profileId));
            if (context.mounted) toast(context, 'Profile ID copied');
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          value: 'ignore',
          child: ListTile(
            leading: const Icon(Icons.visibility_off_outlined),
            title: Text(p.ignored ? 'Show in my results' : 'Not interested'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        const PopupMenuItem(
          value: 'copy',
          child: ListTile(leading: Icon(Icons.copy_rounded), title: Text('Copy profile ID'), contentPadding: EdgeInsets.zero),
        ),
        const PopupMenuItem(
          value: 'report',
          child: ListTile(leading: Icon(Icons.flag_outlined), title: Text('Report'), contentPadding: EdgeInsets.zero),
        ),
        const PopupMenuItem(
          value: 'block',
          child: ListTile(
            leading: Icon(Icons.block_rounded, color: C.danger),
            title: Text('Block', style: TextStyle(color: C.danger)),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
    );
  }
}

class _ProfileBody extends ConsumerWidget {
  const _ProfileBody({required this.p});
  final FullProfile p;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = p.card;
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final children = c.childrenCount > 0
        ? '${c.childrenCount} ${c.childrenCount == 1 ? 'child' : 'children'}${p.childrenLiveWithMe ? ', living with them' : ''}'
        : 'None';

    final gallery = _Gallery(p: p);
    final details = [
      _header(context, ref, children),
      const SizedBox(height: 12),
      _match(context),
      const SizedBox(height: 12),
      _ContactCard(p: p),
      if (p.aboutMe != null || p.lookingFor != null) ...[const SizedBox(height: 12), _about(context)],
      const SizedBox(height: 12),
      _facts(children),
      SizedBox(height: MediaQuery.paddingOf(context).bottom + 24),
    ];

    if (wide) {
      return SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(S.gutter),
        child: ContentWidth(
          max: 1100,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 380, child: gallery),
              const SizedBox(width: 20),
              Expanded(child: Column(children: details)),
            ],
          ),
        ),
      );
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, 0),
      children: [ContentWidth(child: Column(children: [ContentWidth(max: 460, child: gallery), const SizedBox(height: 14), ...details]))],
    );
  }

  Widget _header(BuildContext context, WidgetRef ref, String children) {
    final c = p.card;
    final t = Theme.of(context).textTheme;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(spacing: 6, runSpacing: 6, children: [
            MatchChip(p.matchScoreValue),
            if (p.presenceOnline)
              const Pill('● Online now', tone: PillTone.ok)
            else if (p.lastSeenAt != null)
              Pill('Active ${ago(p.lastSeenAt)}'),
            if (p.interest?.status == 'ACCEPTED') const Pill('Connected', tone: PillTone.love),
            if (p.verifiedMobile) const Pill('Mobile verified', tone: PillTone.ok, icon: Icons.verified_rounded),
          ]),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: NameLine(
                  name: c.name,
                  age: c.age,
                  premium: c.premium,
                  badge: c.planBadge,
                  tick: 20,
                  style: t.headlineSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          GestureDetector(
            onLongPress: () => Clipboard.setData(ClipboardData(text: c.profileId)),
            child: Text('ID ${c.profileId}', style: const TextStyle(fontSize: 12.5, color: C.ink3, fontWeight: FontWeight.w600)),
          ),
          const SizedBox(height: 6),
          if (c.city != null || c.state != null)
            _iconLine(Icons.place_outlined, [c.city, c.state].whereType<String>().join(', ')),
          if (c.profession != null) _iconLine(Icons.work_outline_rounded, c.profession!),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (c.maritalStatus != null) Pill(marital[c.maritalStatus] ?? c.maritalStatus!),
            if (c.religion != null) Pill(c.religion!),
            if (c.motherTongue != null) Pill(c.motherTongue!),
            if (height(c.heightCm) != null) Pill(height(c.heightCm)!),
            Pill(children == 'None' ? 'No children' : children),
          ]),
          const SizedBox(height: 16),
          _InterestActions(p: p),
          _usageLine(context, ref),
        ],
      ),
    );
  }

  Widget _usageLine(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    if (p.interest?.status == 'ACCEPTED' && me != null && !me.features.startChats) {
      return const Padding(
        padding: EdgeInsets.only(top: 10),
        child: Text('On your plan you can reply when a paid member writes first. Upgrade to start conversations yourself.',
            style: TextStyle(fontSize: 12.5, color: C.ink3)),
      );
    }
    final left = ref.watch(usageProvider).value?.remainingInterests;
    if (p.interest != null || left == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Text(
        left > 0
            ? 'You can send $left more ${left == 1 ? 'interest' : 'interests'} today.'
            : 'You have used all of today’s interests. They reset at midnight.',
        style: TextStyle(fontSize: 12.5, color: left > 0 ? C.ink3 : C.coral, fontWeight: FontWeight.w500),
      ),
    );
  }

  Widget _iconLine(IconData icon, String text) => Padding(
        padding: const EdgeInsets.only(top: 3),
        child: Row(children: [
          Icon(icon, size: 16, color: C.brand),
          const SizedBox(width: 5),
          Expanded(child: Text(text, style: const TextStyle(color: C.ink2, fontSize: 14))),
        ]),
      );

  Widget _match(BuildContext context) {
    return SectionCard(
      title: 'How you match',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (p.matchHighlights.isNotEmpty)
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final h in p.matchHighlights) Pill(h, icon: Icons.check_circle_rounded, tone: PillTone.ok),
            ]),
          if (p.breakdownLocked) ...[
            const SizedBox(height: 10),
            LockedNote('See exactly which of your preferences match — and which of theirs you meet.',
                onSeePlans: () => context.push('/plans')),
          ] else ...[
            if (p.dealBreaker) ...[
              const SizedBox(height: 10),
              const Notice('One of you has marked a preference here as a must-have that is not met.'),
            ],
            const SizedBox(height: 12),
            const Text('Your preferences', style: TextStyle(fontSize: 13, color: C.ink3, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            _criteria(p.theyFitYou, 'You have not set partner preferences yet.'),
            const SizedBox(height: 12),
            const Text('Their preferences', style: TextStyle(fontSize: 13, color: C.ink3, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            _criteria(p.youFitThem, 'They are open — no specific preferences.'),
          ],
        ],
      ),
    );
  }

  Widget _criteria(List<Criterion> items, String empty) {
    if (items.isEmpty) return Text(empty, style: const TextStyle(color: C.ink3, fontSize: 13.5));
    return Wrap(spacing: 6, runSpacing: 6, children: [
      for (final c in items)
        Pill(c.label, tone: c.met ? PillTone.love : PillTone.neutral, icon: c.met ? Icons.check_rounded : Icons.close_rounded),
    ]);
  }

  Widget _about(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (p.aboutMe != null) ...[
            Text('About ${p.card.firstName}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            SelectableText(p.aboutMe!, style: const TextStyle(fontSize: 15, height: 1.5, color: C.ink2)),
          ],
          if (p.lookingFor != null) ...[
            if (p.aboutMe != null) const SizedBox(height: 16),
            Text('Looking for', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            SelectableText(p.lookingFor!, style: const TextStyle(fontSize: 15, height: 1.5, color: C.ink2)),
          ],
          if (p.detailsLocked) ...[
            const SizedBox(height: 12),
            LockedNote('Read the full profile, including what they are looking for, with a paid plan.',
                onSeePlans: () => context.push('/plans')),
          ],
        ],
      ),
    );
  }

  Widget _facts(String children) {
    final c = p.card;
    final locked = p.detailsLocked ? '🔒 Paid plans' : null;
    final rows = <(String, String?)>[
      ('Age', c.age?.toString()),
      ('Height', height(c.heightCm)),
      ('Marital status', c.maritalStatus == null ? null : marital[c.maritalStatus]),
      ('Children', children),
      ('Wants more children', p.wantsMoreChildren == null ? null : (p.wantsMoreChildren! ? 'Yes' : 'No')),
      ('Religion', c.religion),
      ('Community', locked ?? p.community),
      ('Mother tongue', c.motherTongue),
      ('Education', c.education),
      ('Profession', c.profession),
      ('Income', locked ?? income(p.incomeLpa)),
      ('Lives in', [c.city, c.state].whereType<String>().join(', ')),
      ('Diet', p.diet == null ? null : diets[p.diet]),
      ('Smokes', p.smoking == null ? null : habits[p.smoking]),
      ('Drinks', p.drinking == null ? null : habits[p.drinking]),
      ('Member since', p.memberSince == null ? null : date(p.memberSince)),
    ].where((r) => r.$2 != null && r.$2!.isNotEmpty).toList();
    return SectionCard(
      title: 'Details',
      child: LayoutBuilder(builder: (context, box) {
        final cols = box.maxWidth >= 520 ? 3 : 2;
        final w = (box.maxWidth - (cols - 1) * 8) / cols;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (k, v) in rows)
              Container(
                width: w,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(color: C.soft, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(k, style: const TextStyle(fontSize: 11.5, color: C.ink3, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(v!, style: const TextStyle(fontSize: 14, color: C.ink, fontWeight: FontWeight.w500)),
                  ],
                ),
              ),
          ],
        );
      }),
    );
  }
}

class _Gallery extends StatefulWidget {
  const _Gallery({required this.p});
  final FullProfile p;
  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  final _page = PageController();
  int index = 0;

  @override
  void dispose() {
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.p;
    final photos = p.photos;
    final lockText = p.card.photoLock == 'CONNECTIONS_ONLY'
        ? 'Shared once you are connected.'
        : p.card.photoLock == 'PAID_ONLY'
            ? 'Visible to members on paid plans.'
            : photoLockText[p.card.photoLock];
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: AspectRatio(
            aspectRatio: 4 / 5,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (photos.isEmpty)
                  Photo(url: null, name: p.card.name, radius: BorderRadius.zero)
                else
                  PageView.builder(
                    controller: _page,
                    itemCount: photos.length,
                    onPageChanged: (i) => setState(() => index = i),
                    itemBuilder: (c, i) => GestureDetector(
                      onTap: () => PhotoViewer.open(context, photos, p.card.name, i),
                      child: Photo(url: photos[i], name: p.card.name, radius: BorderRadius.zero),
                    ),
                  ),
                if (photos.length > 1)
                  Positioned(
                    left: 12,
                    right: 12,
                    top: 12,
                    child: Row(children: [
                      for (var i = 0; i < photos.length; i++)
                        Expanded(
                          child: Container(
                            height: 3.5,
                            margin: const EdgeInsets.symmetric(horizontal: 2),
                            decoration: BoxDecoration(
                              color: i == index ? Colors.white : Colors.white.withValues(alpha: 0.45),
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                    ]),
                  ),
                if (p.photosLocked > 0 && lockText != null)
                  Positioned(
                    left: 12,
                    right: 12,
                    bottom: 12,
                    child: GestureDetector(
                      onTap: () => context.push('/plans'),
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: C.surface, borderRadius: BorderRadius.circular(12)),
                        child: Row(children: [
                          const Icon(Icons.lock_rounded, color: C.gold, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text('${plural(p.photosLocked, 'more photo')} · $lockText',
                                style: const TextStyle(fontSize: 13, color: C.ink)),
                          ),
                        ]),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Send / accept / decline / withdraw / message, depending on where things stand.
class _InterestActions extends ConsumerStatefulWidget {
  const _InterestActions({required this.p});
  final FullProfile p;
  @override
  ConsumerState<_InterestActions> createState() => _InterestActionsState();
}

class _InterestActionsState extends ConsumerState<_InterestActions> {
  String? busy;

  Future<void> _run(String key, Future<void> Function() f) async {
    if (busy != null) return;
    setState(() => busy = key);
    try {
      await f();
    } finally {
      if (mounted) setState(() => busy = null);
    }
  }

  Future<void> _sendWithNote() async {
    final p = widget.p.card;
    final me = ref.read(meProvider);
    final note = await showAppSheet<String>(context, builder: (c) => _InterestNote(name: p.firstName, canNote: me?.features.interestNote ?? false));
    if (note == null || !mounted) return;
    await _run('send', () async {
      await sendInterest(context, ref, p.userId, p.firstName, note: note, connects: widget.p.interest?.direction == 'received');
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.p;
    final i = p.interest;
    final c = p.card;
    final shortlist = AppButton(
      label: c.shortlisted ? 'Shortlisted' : 'Shortlist',
      icon: c.shortlisted ? Icons.star_rounded : Icons.star_outline_rounded,
      variant: ButtonVariant.secondary,
      loading: busy == 'star',
      onPressed: () => _run('star', () => setShortlisted(context, ref, c.userId, !c.shortlisted)),
    );

    final List<Widget> main;
    if (i?.status == 'ACCEPTED') {
      main = [
        AppButton(label: 'Message', icon: Icons.chat_bubble_rounded, onPressed: () => context.push('/chat/${c.userId}')),
      ];
    } else if (i?.direction == 'received' && i?.status == 'PENDING') {
      main = [
        AppButton(
          label: 'Accept interest',
          icon: Icons.favorite_rounded,
          loading: busy == 'accept',
          onPressed: () => _run('accept', () => respondInterest(context, ref, i!.id, c.userId, true, name: c.firstName)),
        ),
        AppButton(
          label: 'Decline',
          variant: ButtonVariant.secondary,
          loading: busy == 'decline',
          onPressed: () => _run('decline', () => respondInterest(context, ref, i!.id, c.userId, false)),
        ),
      ];
    } else if (i?.direction == 'received' && i?.status == 'DECLINED') {
      main = [
        AppButton(
          label: 'Accept after all',
          variant: ButtonVariant.secondary,
          loading: busy == 'accept',
          onPressed: () => _run('accept', () => respondInterest(context, ref, i!.id, c.userId, true, name: c.firstName)),
        ),
      ];
    } else if (i?.direction == 'sent') {
      main = [
        i!.status == 'PENDING'
            ? AppButton(
                label: 'Interest sent · Withdraw',
                variant: ButtonVariant.secondary,
                loading: busy == 'withdraw',
                onPressed: () async {
                  if (!await confirm(context, title: 'Withdraw your interest?', yes: 'Withdraw')) return;
                  if (mounted) await _run('withdraw', () => withdrawInterest(context, ref, i.id, c.userId));
                },
              )
            : const AppButton(label: 'Not interested', variant: ButtonVariant.secondary),
      ];
    } else {
      main = [
        AppButton(label: 'Send interest', icon: Icons.favorite_rounded, loading: busy == 'send', onPressed: _sendWithNote),
      ];
    }
    return Wrap(spacing: 8, runSpacing: 8, children: [...main, shortlist]);
  }
}

class _InterestNote extends StatefulWidget {
  const _InterestNote({required this.name, required this.canNote});
  final String name;
  final bool canNote;
  @override
  State<_InterestNote> createState() => _InterestNoteState();
}

class _InterestNoteState extends State<_InterestNote> {
  final _note = TextEditingController();
  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.paddingOf(context).bottom),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Send interest to ${widget.name}', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 10),
          if (widget.canNote) ...[
            const FieldLabel('Add a short note', optional: true),
            TextField(
              controller: _note,
              maxLines: 4,
              maxLength: 300,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(hintText: 'Hello ${widget.name}, I read your profile and…'),
            ),
            const FieldHint('A warm, specific note gets more replies.'),
          ] else ...[
            Text('${widget.name} will be told you are interested and can accept or decline.',
                style: const TextStyle(color: C.ink2)),
            const SizedBox(height: 12),
            const LockedNote('Adding a personal note to your interest is part of paid plans.'),
          ],
          const SizedBox(height: 18),
          AppButton(label: 'Send interest', expand: true, onPressed: () => Navigator.pop(context, _note.text)),
        ],
      ),
    );
  }
}

/// Mobile number and email, when the member shares them and the viewer's plan allows.
class _ContactCard extends ConsumerStatefulWidget {
  const _ContactCard({required this.p});
  final FullProfile p;
  @override
  ConsumerState<_ContactCard> createState() => _ContactCardState();
}

class _ContactCardState extends ConsumerState<_ContactCard> {
  bool busy = false;
  ContactState? revealed;

  Future<void> _reveal() async {
    setState(() => busy = true);
    await runGuarded(context, () async {
      final r = await Api.instance.post('/profiles/${widget.p.card.userId}/contact');
      if (mounted) setState(() => revealed = ContactState.fromJson(r));
      ref.invalidate(usageProvider);
    });
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.p;
    final c = revealed ?? p.contact;
    final first = p.card.firstName;
    final what = [if (c.sharesPhone) 'mobile number', if (c.sharesEmail) 'email'].join(' and ');
    Widget body;
    switch (c.state) {
      case 'REVEALED':
        body = Column(children: [
          if (c.phone != null)
            _ContactRow(
              icon: Icons.call_rounded,
              label: 'Mobile',
              value: phone(c.phone) ?? c.phone!,
              actions: [
                (Icons.call_rounded, 'Call', () => launchExternal('tel:${c.phone}')),
                (Icons.sms_outlined, 'SMS', () => launchExternal('sms:${c.phone}')),
              ],
            ),
          if (c.email != null)
            _ContactRow(
              icon: Icons.mail_outline_rounded,
              label: 'Email',
              value: c.email!,
              actions: [(Icons.send_rounded, 'Email', () => launchExternal('mailto:${c.email}'))],
            ),
        ]);
      case 'AVAILABLE':
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$first shares their $what with members like you.', style: const TextStyle(color: C.ink2)),
            if (c.remaining != null)
              Text('${plural(c.remaining!, 'unlock')} left in your plan this month.',
                  style: const TextStyle(fontSize: 12.5, color: C.ink3)),
            const SizedBox(height: 10),
            AppButton(label: 'View contact', icon: Icons.call_rounded, loading: busy, onPressed: _reveal),
          ],
        );
      case 'LIMIT':
        body = LockedNote('You have used all contact unlocks in your plan for the last 30 days.',
            onSeePlans: () => context.push('/plans'));
      case 'UPGRADE':
        body = LockedNote('$first shares their $what. Viewing contact details is part of paid plans.',
            onSeePlans: () => context.push('/plans'));
      case 'NOT_SHARED':
        body = Text(
          '$first keeps their contact details private. ${p.card.connected ? 'Message them here on 2ndShaadi.' : 'Send an interest — once connected you can chat here.'}',
          style: const TextStyle(color: C.ink2),
        );
      default:
        body = const Text('Contact details are not available right now.', style: TextStyle(color: C.ink2));
    }
    return SectionCard(
      title: 'Contact details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          body,
          const SizedBox(height: 10),
          GestureDetector(
            onTap: () => context.push('/page/safety'),
            child: const Text('Never send money or share OTPs. Safety tips',
                style: TextStyle(fontSize: 12, color: C.ink3, decoration: TextDecoration.underline)),
          ),
        ],
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({required this.icon, required this.label, required this.value, required this.actions});
  final IconData icon;
  final String label, value;
  final List<(IconData, String, VoidCallback)> actions;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
        decoration: BoxDecoration(border: Border.all(color: C.line), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          Icon(icon, color: C.brand),
          const SizedBox(width: 10),
          Expanded(
            child: GestureDetector(
              onLongPress: () {
                Clipboard.setData(ClipboardData(text: value));
                toast(context, '$label copied');
              },
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: const TextStyle(fontSize: 11.5, color: C.ink3, fontWeight: FontWeight.w600)),
                Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
          for (final (i, tip, onTap) in actions) IconButton(tooltip: tip, onPressed: onTap, icon: Icon(i, color: C.brand)),
        ]),
      );
}
