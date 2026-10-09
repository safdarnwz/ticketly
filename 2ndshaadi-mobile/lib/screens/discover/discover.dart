import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../app/links.dart';
import '../../app/theme.dart';
import '../../core/actions.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/member.dart';
import '../../widgets/photo.dart';
import 'filters.dart';
import 'saved_searches.dart';

const _tabs = [
  ('all', 'All matches', 'Everyone who fits, best matches first.'),
  ('recommended', 'New to you', 'People you have not sent or received an interest from yet.'),
  ('mutual', 'Mutual matches', 'You fit what they want, and they fit what you want.'),
  ('new', 'Just joined', 'Members who joined in the last two weeks.'),
  ('nearby', 'Near you', 'In your city or state.'),
  ('online', 'Online now', 'Members active right now.'),
  ('premium', 'Premium', 'Members on paid plans — serious about meeting.'),
];

class DiscoverScreen extends ConsumerStatefulWidget {
  const DiscoverScreen({super.key, this.openSaved = false});
  final bool openSaved;
  @override
  ConsumerState<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends ConsumerState<DiscoverScreen> {
  Filters filters = {};
  String sort = 'match';
  String tab = 'all';
  final _scroll = ScrollController();
  final Set<String> _gone = {};

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      // Straight after sign-in with an unfinished profile: open the editor once.
      final session = ref.read(sessionProvider.notifier);
      final next = session.afterSignIn;
      session.afterSignIn = null;
      if (next != null) context.push(next == 'new' ? '/edit-profile?welcome=1' : '/edit-profile');
      if (widget.openSaved) _openSaved();
    });
  }

  @override
  void didUpdateWidget(DiscoverScreen old) {
    super.didUpdateWidget(old);
    if (widget.openSaved && !old.openSaved) WidgetsBinding.instance.addPostFrameCallback((_) => _openSaved());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  String get _query {
    final f = {...filters};
    final me = ref.read(meProvider);
    // Paid filters left over after a plan ends are ignored instead of failing.
    if (me != null && !me.features.advancedFilters) {
      for (final k in advancedKeys) {
        f.remove(k);
      }
    }
    return Uri(queryParameters: {...f, 'sort': sort, 'tab': tab}).query;
  }

  bool _tabLocked(String t, Me? me) => t == 'online' && !(me?.features.seeOnlineStatus ?? false);

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_scroll.position.extentAfter < 900) ref.read(searchProvider(_query).notifier).loadMore();
  }

  void _apply(Filters f) {
    setState(() {
      filters = cleanFilters(f);
      _gone.clear();
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  Future<void> _openFilters() async {
    final me = ref.read(meProvider);
    final r = await showAppSheet<Filters>(
      context,
      full: true,
      builder: (c) => FilterSheet(initial: filters, advanced: me?.features.advancedFilters ?? false),
    );
    if (r != null) _apply(r);
  }

  Future<void> _openSaved() async {
    final r = await showSavedSearches(context);
    if (r != null) _apply(r);
  }

  Future<void> _findById() async {
    final c = TextEditingController();
    final id = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Find by profile ID'),
        content: TextField(
          controller: c,
          autofocus: true,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(hintText: 'e.g. 2S10001', prefixIcon: Icon(Icons.tag_rounded)),
          onSubmitted: (v) => Navigator.pop(d, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel', style: TextStyle(color: C.ink2))),
          TextButton(onPressed: () => Navigator.pop(d, c.text), child: const Text('Find')),
        ],
      ),
    );
    c.dispose();
    if (id == null || !mounted) return;
    final no = profileNumber(id);
    if (no == null) return toast(context, 'Enter a profile ID like 2S10001.', error: true);
    await runGuarded(context, () async {
      final r = asMap(await Api.instance.get('/profiles/by-number/2S$no'));
      if (!mounted) return;
      if (boolean(r['self'])) {
        context.push('/edit-profile');
      } else {
        context.push('/profile/${str(r['userId'])}');
      }
    });
  }

  Future<void> _swipeInterest(MemberCard p) async {
    setState(() => _gone.add(p.userId));
    final ok = await sendInterest(context, ref, p.userId, p.firstName);
    if (!ok && mounted) setState(() => _gone.remove(p.userId));
  }

  Future<void> _swipeHide(MemberCard p) async {
    setState(() => _gone.add(p.userId));
    final ok = await setIgnored(context, ref, p.userId, true);
    if (!ok && mounted) setState(() => _gone.remove(p.userId));
  }

  Future<void> _toggleShortlist(MemberCard p) async {
    final ctrl = ref.read(searchProvider(_query).notifier);
    ctrl.update((x) => x.userId == p.userId ? x.copyWith(shortlisted: !p.shortlisted) : x);
    final ok = await setShortlisted(context, ref, p.userId, !p.shortlisted);
    if (!ok) ctrl.update((x) => x.userId == p.userId ? x.copyWith(shortlisted: p.shortlisted) : x);
  }

  Future<void> _refresh() async {
    ref.invalidate(countsProvider);
    ref.invalidate(usageProvider);
    ref.invalidate(freshMembersProvider);
    ref.invalidate(visitorsProvider);
    ref.invalidate(memberAnnouncementsProvider);
    setState(_gone.clear);
    await ref.read(searchProvider(_query).notifier).refresh();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final query = _query;
    final locked = _tabLocked(tab, me);
    final results = ref.watch(searchProvider(query));
    final width = MediaQuery.sizeOf(context).width;
    final grid = width >= 720;
    final shown = results.items.where((p) => !_gone.contains(p.userId)).toList();
    final groupsOn = activeGroups(filters);
    final saved = ref.watch(savedSearchesProvider).value;
    final newInSaved = saved?.items.fold<int>(0, (n, s) => n + s.newCount) ?? 0;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: S.gutter,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${greeting()},', style: const TextStyle(fontSize: 12.5, color: C.brand, fontWeight: FontWeight.w600)),
            Text(me?.firstName ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ),
        actions: [
          IconButton(tooltip: 'Find by profile ID', onPressed: _findById, icon: const Icon(Icons.tag_rounded)),
          IconButton(
            tooltip: 'Saved searches',
            onPressed: _openSaved,
            icon: CountBadge(newInSaved, child: const Icon(Icons.bookmark_border_rounded)),
          ),
          IconButton(
            tooltip: 'Filters',
            onPressed: _openFilters,
            icon: CountBadge(groupsOn.length, child: const Icon(Icons.tune_rounded)),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: ContentWidth(
                max: 1100,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const AccountNotices(showChatBan: false),
                      const _Announcements(),
                      _Stats(),
                      const SizedBox(height: 10),
                      const _UsageStrip(),
                      if (me != null && !me.profileComplete) ...[const SizedBox(height: 10), _CompletionNudge(me: me)],
                      if (tab == 'all') const _JustJoined(),
                      const SizedBox(height: 18),
                    ],
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: S.gutter),
                  itemCount: _tabs.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (c, i) {
                    final (value, label, _) = _tabs[i];
                    final on = tab == value;
                    return ChoiceChip(
                      label: Row(mainAxisSize: MainAxisSize.min, children: [
                        if (_tabLocked(value, me)) ...[
                          Icon(Icons.lock_rounded, size: 14, color: on ? Colors.white : C.ink3),
                          const SizedBox(width: 4),
                        ],
                        Text(label),
                      ]),
                      selected: on,
                      showCheckmark: false,
                      selectedColor: C.button,
                      backgroundColor: C.surface,
                      side: BorderSide(color: on ? C.button : C.lineStrong),
                      labelStyle: TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w600, color: on ? Colors.white : C.ink2),
                      onSelected: (_) {
                        HapticFeedback.selectionClick();
                        setState(() {
                          tab = value;
                          _gone.clear();
                        });
                      },
                    );
                  },
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: ContentWidth(
                max: 1100,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(S.gutter, 12, S.gutter, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(_tabs.firstWhere((t) => t.$1 == tab).$3,
                                style: const TextStyle(fontSize: 13, color: C.ink2)),
                          ),
                          PopupMenuButton<String>(
                            tooltip: 'Sort',
                            initialValue: sort,
                            onSelected: (v) => setState(() {
                              sort = v;
                              _gone.clear();
                            }),
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'match', child: Text('Best match')),
                              PopupMenuItem(value: 'newest', child: Text('Newest')),
                              PopupMenuItem(value: 'active', child: Text('Recently active')),
                            ],
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                              child: Row(mainAxisSize: MainAxisSize.min, children: [
                                const Icon(Icons.swap_vert_rounded, size: 18, color: C.ink2),
                                const SizedBox(width: 4),
                                Text(
                                  sort == 'match' ? 'Best match' : sort == 'newest' ? 'Newest' : 'Recently active',
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: C.ink),
                                ),
                              ]),
                            ),
                          ),
                        ],
                      ),
                      if (groupsOn.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final id in groupsOn)
                              if (groupLabel(id, filters) != null)
                                InputChip(
                                  label: Text(groupLabel(id, filters)!, overflow: TextOverflow.ellipsis),
                                  onDeleted: () {
                                    final keys = filterGroups.firstWhere((g) => g.$1 == id).$2;
                                    _apply({...filters}..removeWhere((k, _) => keys.contains(k)));
                                  },
                                  backgroundColor: C.brandSoft,
                                  side: BorderSide.none,
                                  labelStyle: const TextStyle(fontSize: 12.5, color: C.brand, fontWeight: FontWeight.w600),
                                  deleteIconColor: C.brand,
                                ),
                            ActionChip(
                              avatar: const Icon(Icons.bookmark_add_outlined, size: 16, color: C.brand),
                              label: const Text('Save search'),
                              onPressed: () => showSaveSearch(context, filters),
                            ),
                            ActionChip(label: const Text('Clear all'), onPressed: () => _apply({})),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            if (locked)
              SliverToBoxAdapter(
                child: EmptyState(
                  icon: Icons.workspace_premium_outlined,
                  title: 'Online now is part of paid plans',
                  body: 'Upgrade to see who is online right now and start a conversation while they are here.',
                  action: AppButton(label: 'See plans', onPressed: () => context.push('/plans')),
                ),
              )
            else if (results.loading && results.items.isEmpty)
              const SliverToBoxAdapter(child: ListSkeleton(rows: 5, height: 96))
            else if (results.error != null && results.items.isEmpty)
              SliverToBoxAdapter(
                child: ErrorState(error: results.error, onRetry: () => ref.read(searchProvider(query).notifier).refresh()),
              )
            else if (shown.isEmpty && !results.hasMore)
              SliverToBoxAdapter(child: _empty(results.meta))
            else ...[
              if (!grid)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(S.gutter, 0, S.gutter, 8),
                    child: Text('Swipe right to send interest, left to hide.',
                        style: TextStyle(fontSize: 12, color: C.ink3)),
                  ),
                ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: S.gutter),
                sliver: grid
                    ? SliverGrid.builder(
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: gridColumns(width),
                          mainAxisSpacing: 14,
                          crossAxisSpacing: 14,
                          childAspectRatio: 0.62,
                        ),
                        itemCount: shown.length,
                        itemBuilder: (c, i) => MemberTile(
                          key: ValueKey(shown[i].userId),
                          p: shown[i],
                          onToggleShortlist: () => _toggleShortlist(shown[i]),
                          onHide: () => _swipeHide(shown[i]),
                        ),
                      )
                    : SliverList.separated(
                        itemCount: shown.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (c, i) => _SwipeRow(
                          key: ValueKey(shown[i].userId),
                          p: shown[i],
                          onInterest: _swipeInterest,
                          onHide: _swipeHide,
                          onStar: _toggleShortlist,
                        ),
                      ),
              ),
              SliverToBoxAdapter(child: _footer(results)),
            ],
            SliverToBoxAdapter(child: SizedBox(height: MediaQuery.paddingOf(context).bottom + 24)),
          ],
        ),
      ),
    );
  }

  Widget _footer(PagedState<MemberCard> r) {
    if (r.loadingMore || r.hasMore) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: Center(child: SizedBox.square(dimension: 26, child: CircularProgressIndicator(strokeWidth: 2.5))),
      );
    }
    if (boolean(r.meta['capped'])) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: Text('Showing the best ${plural(r.total, 'match', 'matches')}. Add a filter to see more people like these.',
            textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: C.ink3)),
      );
    }
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Text(r.items.isEmpty ? '' : 'You have seen everyone here. New members join every day.',
          textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: C.ink3)),
    );
  }

  Widget _empty(Json meta) {
    final active = activeGroups(filters).isNotEmpty;
    final suggestions = asList(meta['suggestions'], (j) => (str(j['group']), strList(j['keys']), integer(j['count'])));
    return EmptyState(
      icon: Icons.person_search_outlined,
      title: active ? 'No one matches all these filters' : 'No one here yet',
      body: active
          ? (suggestions.isNotEmpty
              ? 'These filters are hiding people. Remove one to see them:'
              : 'Try a wider age range or remove a filter.')
          : tab == 'nearby'
              ? 'Add your city and state to your profile, or try all matches.'
              : 'New members join every day. Check back soon.',
      action: Wrap(
        alignment: WrapAlignment.center,
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final (group, keys, count) in suggestions)
            AppButton(
              dense: true,
              variant: ButtonVariant.secondary,
              label:
                  'Remove “${group == 'minScore' ? 'Strong matches only' : filterGroups.where((g) => g.$1 == group).firstOrNull?.$3 ?? group}” · ${plural(count, 'person', 'people')}',
              onPressed: () => _apply({...filters}..removeWhere((k, _) => keys.contains(k))),
            ),
          if (active)
            AppButton(label: 'Clear all filters', variant: ButtonVariant.secondary, onPressed: () => _apply({}))
          else if (tab != 'all')
            AppButton(label: 'See all matches', variant: ButtonVariant.secondary, onPressed: () => setState(() => tab = 'all'))
          else
            AppButton(
                label: 'Review preferences',
                variant: ButtonVariant.secondary,
                onPressed: () => context.push('/preferences')),
        ],
      ),
    );
  }
}

/// Swipe right: send interest. Swipe left: not interested.
class _SwipeRow extends StatelessWidget {
  const _SwipeRow({super.key, required this.p, required this.onInterest, required this.onHide, required this.onStar});
  final MemberCard p;
  final ValueChanged<MemberCard> onInterest;
  final ValueChanged<MemberCard> onHide;
  final ValueChanged<MemberCard> onStar;

  @override
  Widget build(BuildContext context) {
    Widget bg(Alignment a, Color c, IconData i, String t) => Container(
          alignment: a,
          padding: const EdgeInsets.symmetric(horizontal: 22),
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(S.radius)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(i, color: Colors.white),
              const SizedBox(width: 8),
              Text(t, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
            ],
          ),
        );
    return Dismissible(
      key: ValueKey('swipe-${p.userId}'),
      dismissThresholds: const {DismissDirection.startToEnd: 0.35, DismissDirection.endToStart: 0.35},
      background: bg(Alignment.centerLeft, C.button, Icons.favorite_rounded, 'Send interest'),
      secondaryBackground: bg(Alignment.centerRight, C.ink2, Icons.visibility_off_rounded, 'Not interested'),
      confirmDismiss: (dir) async {
        HapticFeedback.mediumImpact();
        if (dir == DismissDirection.startToEnd) {
          onInterest(p);
        } else {
          onHide(p);
        }
        // The parent removes the row itself (and puts it back if the call fails).
        return false;
      },
      child: MemberRow(
        p: p,
        trailing: IconButton(
          tooltip: p.shortlisted ? 'Remove from shortlist' : 'Shortlist',
          onPressed: () => onStar(p),
          icon: Icon(p.shortlisted ? Icons.star_rounded : Icons.star_outline_rounded,
              color: p.shortlisted ? C.gold : C.ink3),
        ),
      ),
    );
  }
}

class _Stats extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counts = ref.watch(countsProvider).value ?? Counts.zero;
    final views = ref.watch(visitorsProvider).value?.count ?? 0;
    Widget stat(IconData icon, Color tone, int value, String label, VoidCallback onTap) => Expanded(
          child: Material(
            color: C.surface,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: onTap,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
                decoration: BoxDecoration(border: Border.all(color: C.line), borderRadius: BorderRadius.circular(12)),
                child: Column(
                  children: [
                    Icon(icon, color: tone, size: 22),
                    const SizedBox(height: 4),
                    Text('$value', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: C.ink)),
                    Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: C.ink3)),
                  ],
                ),
              ),
            ),
          ),
        );
    return Row(
      children: [
        stat(Icons.favorite_rounded, C.coral, counts.interests, 'Interests', () => context.go('/interests')),
        const SizedBox(width: 8),
        stat(Icons.chat_bubble_rounded, C.brand, counts.messages, 'Unread', () => context.go('/chats')),
        const SizedBox(width: 8),
        stat(Icons.visibility_rounded, C.gold, views, 'Views', () => context.push('/visitors')),
      ],
    );
  }
}

class _UsageStrip extends ConsumerWidget {
  const _UsageStrip();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(usageProvider).value;
    if (u == null) return const SizedBox(height: 0);
    Widget meter(String label, int? left, int total) {
      if (total == 0) return const SizedBox.shrink();
      final unlimited = left == null || total == -1;
      final pct = unlimited ? 1.0 : (total > 0 ? (left / total).clamp(0.0, 1.0) : 0.0);
      return Padding(
        padding: const EdgeInsets.only(right: 14, top: 4, bottom: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 44,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(9),
                child: LinearProgressIndicator(
                  value: pct,
                  minHeight: 5,
                  backgroundColor: C.sunk,
                  color: pct > 0.3 ? C.button : pct > 0 ? C.gold : C.coral,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Text.rich(
              TextSpan(children: [
                TextSpan(
                    text: unlimited ? 'Unlimited' : '$left/$total',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: C.ink)),
                TextSpan(text: ' $label'),
              ]),
              style: const TextStyle(fontSize: 12.5, color: C.ink2),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(12)),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          const Padding(
            padding: EdgeInsets.only(right: 12, top: 4, bottom: 4),
            child: Text('Today', style: TextStyle(fontSize: 12.5, color: C.ink3, fontWeight: FontWeight.w600)),
          ),
          meter('interests', u.remainingInterests, u.features.interestsPerDay),
          meter('profile views', u.remainingProfileViews, u.features.profileViewsPerDay),
          meter('contacts', u.remainingContactViews, u.features.contactViewsPerMonth),
          if (!u.isPaid)
            GestureDetector(
              onTap: () => context.push('/plans'),
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 4),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.workspace_premium_rounded, size: 15, color: C.gold),
                  SizedBox(width: 3),
                  Text('Upgrade for more', style: TextStyle(fontSize: 12.5, color: C.gold, fontWeight: FontWeight.w700)),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}

class _CompletionNudge extends StatelessWidget {
  const _CompletionNudge({required this.me});
  final Me me;
  @override
  Widget build(BuildContext context) {
    final left = me.completionSteps.where((s) => !s.done).map((s) => s.label).take(3).toList();
    return SectionCard(
      child: Row(
        children: [
          SizedBox.square(
            dimension: 48,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                    value: me.completionPercent / 100, strokeWidth: 5, backgroundColor: C.brandSoft, color: C.brand),
                Text('${me.completionPercent}%',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: C.brand)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Finish your profile', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                Text(
                  'Others will see you once it is complete${left.isEmpty ? '' : ' — still to do: ${left.join(', ')}'}.',
                  style: const TextStyle(fontSize: 13, color: C.ink2),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => context.push('/edit-profile'),
            icon: const Icon(Icons.arrow_forward_rounded, color: C.brand),
          ),
        ],
      ),
    );
  }
}

class _JustJoined extends ConsumerWidget {
  const _JustJoined();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fresh = ref.watch(freshMembersProvider);
    final list = fresh.value;
    if (fresh.hasError || (list != null && list.isEmpty)) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 18),
        const Text('Just joined', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 10),
        SizedBox(
          height: 96,
          child: list == null
              ? ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: 6,
                  separatorBuilder: (_, _) => const SizedBox(width: 14),
                  itemBuilder: (_, _) => const Skeleton(height: 66, width: 66, radius: 99),
                )
              : ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                  itemBuilder: (c, i) {
                    final p = list[i];
                    return GestureDetector(
                      onTap: () => context.push('/profile/${p.userId}'),
                      child: SizedBox(
                        width: 72,
                        child: Column(
                          children: [
                            Stack(
                              clipBehavior: Clip.none,
                              children: [
                                Avatar(url: p.photo, name: p.name, size: 66, online: p.online),
                                if (p.premium) const Positioned(right: -3, bottom: 0, child: PremiumTick(size: 19)),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(p.firstName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500)),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Admin announcements for members, each dismissible (remembered on this phone).
class _Announcements extends ConsumerStatefulWidget {
  const _Announcements();
  @override
  ConsumerState<_Announcements> createState() => _AnnouncementsState();
}

class _AnnouncementsState extends ConsumerState<_Announcements> {
  Set<String> dismissed = {};
  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) setState(() => dismissed = (p.getStringList('dismissed_announcements') ?? const []).toSet());
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final list = (ref.watch(memberAnnouncementsProvider).value ?? const <Announcement>[])
        .where((a) => !dismissed.contains('${a.id}:${a.version}'))
        .take(2)
        .toList();
    if (list.isEmpty) return const SizedBox.shrink();
    return Column(
      children: [
        for (final a in list)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.fromLTRB(14, 12, 4, 12),
            decoration: BoxDecoration(color: C.button, borderRadius: BorderRadius.circular(14)),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                    padding: EdgeInsets.only(top: 2), child: Icon(Icons.campaign_rounded, color: Colors.white, size: 20)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(a.title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                      if (a.body.isNotEmpty)
                        Text(a.body, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.35)),
                      if (a.linkUrl != null && a.linkLabel != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: GestureDetector(
                            onTap: () => openLink(context, a.linkUrl),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
                              child: Text(a.linkLabel!,
                                  style: const TextStyle(color: C.brand, fontWeight: FontWeight.w600, fontSize: 13)),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (a.isDismissible)
                  IconButton(
                    tooltip: 'Close',
                    icon: const Icon(Icons.close_rounded, color: Colors.white, size: 20),
                    onPressed: () async {
                      setState(() => dismissed = {...dismissed, '${a.id}:${a.version}'});
                      try {
                        final p = await SharedPreferences.getInstance();
                        await p.setStringList('dismissed_announcements', dismissed.toList());
                      } catch (_) {}
                    },
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
