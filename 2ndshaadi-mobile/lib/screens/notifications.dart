import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/links.dart';
import '../app/theme.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../widgets/common.dart';

const _kinds = {
  'INTEREST_RECEIVED': (Icons.favorite_rounded, C.coral),
  'INTEREST_ACCEPTED': (Icons.how_to_reg_rounded, C.brand),
  'NEW_MESSAGE': (Icons.chat_bubble_rounded, C.brand),
  'PLAN_ACTIVATED': (Icons.workspace_premium_rounded, C.gold),
  'SYSTEM': (Icons.notifications_rounded, C.ink2),
};

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _scroll = ScrollController();
  bool marking = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.hasClients && _scroll.position.extentAfter < 600) ref.read(notificationsProvider.notifier).loadMore();
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _open(AppNotification n) async {
    if (n.readAt == null) {
      ref.read(notificationsProvider.notifier).markRead(n.id);
      Api.instance.patch('/notifications/${n.id}/read').then((_) => ref.invalidate(countsProvider), onError: (_) {});
    }
    if (n.link != null) await openLink(context, n.link);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(notificationsProvider);
    final unread = s.items.any((n) => n.readAt == null);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (unread)
            TextButton(
              onPressed: marking
                  ? null
                  : () async {
                      setState(() => marking = true);
                      final ok = await runGuarded(context, () async => Api.instance.patch('/notifications/read-all'));
                      if (ok) ref.read(notificationsProvider.notifier).markAllRead();
                      ref.invalidate(countsProvider);
                      if (mounted) setState(() => marking = false);
                    },
              child: const Text('Mark all read'),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(countsProvider);
          await ref.read(notificationsProvider.notifier).refresh();
        },
        child: s.loading && s.items.isEmpty
            ? const ListSkeleton(rows: 6, height: 72)
            : s.error != null && s.items.isEmpty
                ? ListView(children: [
                    ErrorState(error: s.error, onRetry: () => ref.read(notificationsProvider.notifier).refresh()),
                  ])
                : s.items.isEmpty
                    ? ListView(children: const [
                        EmptyState(
                          icon: Icons.notifications_none_rounded,
                          title: 'Nothing new',
                          body: 'Interests, new connections and plan updates will appear here.',
                        ),
                      ])
                    : ListView.separated(
                        controller: _scroll,
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom + 16),
                        itemCount: s.items.length + 1,
                        separatorBuilder: (_, _) => const Divider(indent: 64),
                        itemBuilder: (c, i) {
                          if (i == s.items.length) {
                            return s.hasMore
                                ? const Padding(
                                    padding: EdgeInsets.all(18),
                                    child: Center(child: SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.5))),
                                  )
                                : const SizedBox(height: 8);
                          }
                          final n = s.items[i];
                          final (icon, tone) = _kinds[n.type] ?? _kinds['SYSTEM']!;
                          return ContentWidth(
                            child: Material(
                              color: n.readAt == null ? C.brandSoft.withValues(alpha: 0.45) : Colors.transparent,
                              child: InkWell(
                                onTap: () => _open(n),
                                child: Padding(
                                  padding: const EdgeInsets.fromLTRB(S.gutter, 14, S.gutter, 14),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon, color: tone, size: 24)),
                                      const SizedBox(width: 16),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(n.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                                            if (n.body.isNotEmpty)
                                              Text(n.body, style: const TextStyle(fontSize: 13.5, color: C.ink2, height: 1.35)),
                                            const SizedBox(height: 4),
                                            Text(ago(n.createdAt), style: const TextStyle(fontSize: 12, color: C.ink3)),
                                          ],
                                        ),
                                      ),
                                      if (n.readAt == null)
                                        Container(
                                          margin: const EdgeInsets.only(top: 6, left: 8),
                                          width: 9,
                                          height: 9,
                                          decoration: const BoxDecoration(color: C.coral, shape: BoxShape.circle),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}
