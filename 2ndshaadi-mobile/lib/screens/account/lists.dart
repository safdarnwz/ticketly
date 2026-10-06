import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/actions.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/member.dart';

/// Paid-only list: "N people did this — see them with a higher plan".
class _UpgradePanel extends StatelessWidget {
  const _UpgradePanel({required this.title, required this.body});
  final String title, body;
  @override
  Widget build(BuildContext context) => EmptyState(
        icon: Icons.workspace_premium_rounded,
        title: title,
        body: body,
        action: AppButton(label: 'See plans', onPressed: () => context.push('/plans')),
      );
}

class ShortlistScreen extends ConsumerWidget {
  const ShortlistScreen({super.key, this.showMe = false});
  final bool showMe;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      initialIndex: showMe ? 1 : 0,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Shortlist'),
          bottom: const TabBar(tabs: [Tab(text: 'My shortlist'), Tab(text: 'Shortlisted me')]),
        ),
        body: TabBarView(children: [_Mine(), _Me()]),
      ),
    );
  }
}

Widget _cards(BuildContext context, List<MemberCard> list, {Widget Function(MemberCard)? trailing}) {
  final width = MediaQuery.sizeOf(context).width;
  if (width >= 720) {
    return GridView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(S.gutter),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: gridColumns(width),
        mainAxisSpacing: 14,
        crossAxisSpacing: 14,
        childAspectRatio: 0.66,
      ),
      itemCount: list.length,
      itemBuilder: (c, i) => MemberTile(p: list[i]),
    );
  }
  return ListView.separated(
    physics: const AlwaysScrollableScrollPhysics(),
    padding: EdgeInsets.fromLTRB(S.gutter, S.gutter, S.gutter, S.gutter + MediaQuery.paddingOf(context).bottom),
    itemCount: list.length,
    separatorBuilder: (_, _) => const SizedBox(height: 10),
    itemBuilder: (c, i) => MemberRow(p: list[i], trailing: trailing?.call(list[i])),
  );
}

class _Mine extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(shortlistProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(shortlistProvider.future).then((_) {}, onError: (_) {}),
      child: data.when(
        skipLoadingOnRefresh: true,
        loading: () => const ListSkeleton(rows: 4, height: 96),
        error: (e, _) => ListView(children: [ErrorState(error: e, onRetry: () => ref.invalidate(shortlistProvider))]),
        data: (list) => list.isEmpty
            ? ListView(children: [
                EmptyState(
                  icon: Icons.star_outline_rounded,
                  title: 'Your shortlist is empty',
                  body: 'Tap the star on any profile to save it here. Only you can see this list.',
                  action: AppButton(label: 'Go to Discover', variant: ButtonVariant.secondary, onPressed: () => context.go('/discover')),
                ),
              ])
            : _cards(
                context,
                list,
                trailing: (p) => IconButton(
                  tooltip: 'Remove from shortlist',
                  icon: const Icon(Icons.star_rounded, color: C.gold),
                  onPressed: () => setShortlisted(context, ref, p.userId, false),
                ),
              ),
      ),
    );
  }
}

class _Me extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(shortlistedMeProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(shortlistedMeProvider.future).then((_) {}, onError: (_) {}),
      child: data.when(
        skipLoadingOnRefresh: true,
        loading: () => const ListSkeleton(rows: 4, height: 96),
        error: (e, _) => ListView(children: [ErrorState(error: e, onRetry: () => ref.invalidate(shortlistedMeProvider))]),
        data: (d) => d.locked
            ? ListView(children: [
                _UpgradePanel(
                  title: d.count > 0 ? '${plural(d.count, 'member')} shortlisted you' : 'See who shortlists you',
                  body: 'People who saved your profile are likely to welcome an interest from you. See them with a higher plan.',
                ),
              ])
            : d.items.isEmpty
                ? ListView(children: const [
                    EmptyState(
                      icon: Icons.star_outline_rounded,
                      title: 'Nobody has shortlisted you yet',
                      body: 'A complete profile with clear photos gets saved far more often.',
                    ),
                  ])
                : _cards(context, d.items),
      ),
    );
  }
}

class VisitorsScreen extends ConsumerWidget {
  const VisitorsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(visitorsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Who viewed you')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(visitorsProvider.future).then((_) {}, onError: (_) {}),
        child: data.when(
          skipLoadingOnRefresh: true,
          loading: () => const ListSkeleton(rows: 4, height: 96),
          error: (e, _) => ListView(children: [ErrorState(error: e, onRetry: () => ref.invalidate(visitorsProvider))]),
          data: (d) => d.locked
              ? ListView(children: [
                  _UpgradePanel(
                    title: d.count > 0 ? '${plural(d.count, 'person', 'people')} viewed your profile' : 'See who views your profile',
                    body:
                        'Members on paid plans can see who visited their profile — a good sign of who might welcome an interest from you.',
                  ),
                ])
              : d.items.isEmpty
                  ? ListView(children: const [
                      EmptyState(
                        icon: Icons.visibility_outlined,
                        title: 'No visitors yet',
                        body: 'Profiles with several clear photos and a detailed “About you” get many more visits.',
                      ),
                    ])
                  : ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: EdgeInsets.fromLTRB(S.gutter, S.gutter, S.gutter, S.gutter + MediaQuery.paddingOf(context).bottom),
                      itemCount: d.items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (c, i) {
                        final v = d.items[i];
                        return ContentWidth(
                          child: MemberRow(
                            p: v,
                            subtitle: '${summaryLine(age: v.age, maritalStatus: v.maritalStatus, city: v.city)} · Viewed ${ago(v.at)}',
                          ),
                        );
                      },
                    ),
        ),
      ),
    );
  }
}
