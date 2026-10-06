import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../core/actions.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../widgets/common.dart';
import '../widgets/member.dart';
import '../widgets/photo.dart';

const _boxes = ['received', 'sent', 'connected'];
const _empty = {
  'received': (
    'No interests yet',
    'When someone sends you an interest it will appear here. A complete profile with clear photos gets noticed sooner.'
  ),
  'sent': ('You have not sent any interests', 'Browse Discover and send an interest to someone whose profile speaks to you.'),
  'connected': ('No connections yet', 'When an interest is accepted — by you or by them — you are connected and can talk.'),
};

class InterestsScreen extends ConsumerStatefulWidget {
  const InterestsScreen({super.key, this.tab});
  final String? tab;
  @override
  ConsumerState<InterestsScreen> createState() => _InterestsScreenState();
}

class _InterestsScreenState extends ConsumerState<InterestsScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 3, vsync: this, initialIndex: _indexOf(widget.tab));

  int _indexOf(String? t) => t == null ? 0 : (_boxes.contains(t) ? _boxes.indexOf(t) : 0);

  @override
  void didUpdateWidget(InterestsScreen old) {
    super.didUpdateWidget(old);
    if (widget.tab != old.tab && widget.tab != null) _tabs.animateTo(_indexOf(widget.tab));
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final counts = ref.watch(countsProvider).value ?? Counts.zero;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Interests'),
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            Tab(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Text('Received'),
                if (counts.interests > 0) ...[const SizedBox(width: 6), CountBadge(counts.interests)],
              ]),
            ),
            const Tab(text: 'Sent'),
            const Tab(text: 'Connected'),
          ],
        ),
      ),
      body: TabBarView(controller: _tabs, children: [for (final b in _boxes) _Box(box: b)]),
    );
  }
}

class _Box extends ConsumerWidget {
  const _Box({required this.box});
  final String box;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(interestsProvider(box));
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(countsProvider);
        await ref.refresh(interestsProvider(box).future).then((_) {}, onError: (_) {});
      },
      child: data.when(
        skipLoadingOnRefresh: true,
        loading: () => const ListSkeleton(rows: 4, height: 110),
        error: (e, _) => ListView(children: [ErrorState(error: e, onRetry: () => ref.invalidate(interestsProvider(box)))]),
        data: (items) => items.isEmpty
            ? ListView(children: [
                EmptyState(
                  icon: box == 'connected' ? Icons.handshake_outlined : Icons.favorite_border_rounded,
                  title: _empty[box]!.$1,
                  body: _empty[box]!.$2,
                  action: box == 'connected'
                      ? null
                      : AppButton(label: 'Go to Discover', variant: ButtonVariant.secondary, onPressed: () => context.go('/discover')),
                ),
              ])
            : ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.fromLTRB(S.gutter, S.gutter, S.gutter, S.gutter + MediaQuery.paddingOf(context).bottom),
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (c, i) => ContentWidth(child: _Row(item: items[i], box: box)),
              ),
      ),
    );
  }
}

class _Row extends ConsumerStatefulWidget {
  const _Row({required this.item, required this.box});
  final InterestItem item;
  final String box;
  @override
  ConsumerState<_Row> createState() => _RowState();
}

class _RowState extends ConsumerState<_Row> {
  String? busy;
  Future<void> _run(String k, Future<void> Function() f) async {
    if (busy != null) return;
    setState(() => busy = k);
    try {
      await f();
    } finally {
      if (mounted) setState(() => busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final p = item.profile;
    final box = widget.box;
    return SectionCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => context.push('/profile/${p.userId}'),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Avatar(url: p.photo, name: p.name, size: 60),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      NameLine(name: p.name, age: p.age),
                      Text(
                        [if (p.maritalStatus != null) marital[p.maritalStatus], p.city, p.profession]
                            .whereType<String>()
                            .join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, color: C.ink2),
                      ),
                      const SizedBox(height: 6),
                      Wrap(spacing: 6, runSpacing: 4, children: [
                        if (item.matchScore != null) MatchChip(item.matchScore!),
                        if (item.status == 'DECLINED') Pill(box == 'sent' ? 'Not interested' : 'Declined'),
                        if (item.status == 'EXPIRED') const Pill('No reply'),
                        if (box == 'sent' && item.status == 'PENDING') const Pill('Awaiting reply', tone: PillTone.gold),
                      ]),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (item.message != null) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: C.soft, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(12)),
              child: Text('“${item.message}”', style: const TextStyle(fontSize: 14, color: C.ink2, height: 1.4)),
            ),
          ],
          const SizedBox(height: 8),
          Text(box == 'connected' ? 'Connected ${ago(item.respondedAt ?? item.createdAt)}' : ago(item.createdAt),
              style: const TextStyle(fontSize: 12, color: C.ink3)),
          if (_actions(context).isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(children: _actions(context)),
          ],
        ],
      ),
    );
  }

  List<Widget> _actions(BuildContext context) {
    final item = widget.item;
    final p = item.profile;
    final box = widget.box;
    if (box == 'received' && item.status == 'PENDING') {
      return [
        Expanded(
          child: AppButton(
            label: 'Accept',
            icon: Icons.check_rounded,
            dense: true,
            loading: busy == 'a',
            onPressed: () => _run('a', () => respondInterest(context, ref, item.id, p.userId, true, name: p.firstName)),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: AppButton(
            label: 'Decline',
            dense: true,
            variant: ButtonVariant.secondary,
            loading: busy == 'd',
            onPressed: () => _run('d', () => respondInterest(context, ref, item.id, p.userId, false)),
          ),
        ),
      ];
    }
    if (box == 'received' && item.status == 'DECLINED') {
      return [
        AppButton(
          label: 'Accept after all',
          dense: true,
          variant: ButtonVariant.secondary,
          loading: busy == 'a',
          onPressed: () => _run('a', () => respondInterest(context, ref, item.id, p.userId, true, name: p.firstName)),
        ),
      ];
    }
    if (box == 'sent' && item.status == 'PENDING') {
      return [
        AppButton(
          label: 'Withdraw',
          dense: true,
          variant: ButtonVariant.ghost,
          loading: busy == 'w',
          onPressed: () => _run('w', () => withdrawInterest(context, ref, item.id, p.userId)),
        ),
      ];
    }
    if (box == 'connected') {
      return [
        AppButton(
          label: 'Chat',
          icon: Icons.chat_bubble_rounded,
          dense: true,
          onPressed: () => context.push('/chat/${p.userId}'),
        ),
      ];
    }
    return [];
  }
}
