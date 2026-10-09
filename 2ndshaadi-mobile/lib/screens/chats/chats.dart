import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/member.dart';
import '../../widgets/photo.dart';

class ChatsScreen extends ConsumerStatefulWidget {
  const ChatsScreen({super.key});
  @override
  ConsumerState<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends ConsumerState<ChatsScreen> {
  String q = '';
  @override
  Widget build(BuildContext context) {
    final data = ref.watch(conversationsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Chats')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(countsProvider);
          await ref.refresh(conversationsProvider.future).then((_) {}, onError: (_) {});
        },
        child: data.when(
          skipLoadingOnRefresh: true,
          loading: () => const ListSkeleton(rows: 7, height: 64),
          error: (e, _) => ListView(children: [ErrorState(error: e, onRetry: () => ref.invalidate(conversationsProvider))]),
          data: (list) {
            if (list.isEmpty) {
              return ListView(children: [
                const Padding(padding: EdgeInsets.fromLTRB(S.gutter, 8, S.gutter, 0), child: AccountNotices()),
                EmptyState(
                  icon: Icons.forum_outlined,
                  title: 'No conversations yet',
                  body: 'You can chat once an interest between you is accepted.',
                  action: AppButton(label: 'See interests', variant: ButtonVariant.soft, onPressed: () => context.go('/interests')),
                ),
              ]);
            }
            final shown = list.where((c) => c.name.toLowerCase().contains(q.toLowerCase())).toList();
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom + 16),
              children: [
                ContentWidth(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, 8),
                    child: Column(
                      children: [
                        const AccountNotices(),
                        TextField(
                          onChanged: (v) => setState(() => q = v.trim()),
                          decoration: InputDecoration(
                            hintText: 'Search conversations',
                            prefixIcon: const Icon(Icons.search_rounded),
                            isDense: true,
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: C.line)),
                            enabledBorder:
                                OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: C.line)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (shown.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(30),
                    child: Text('No one called “$q”.', textAlign: TextAlign.center, style: const TextStyle(color: C.ink3)),
                  ),
                for (final c in shown)
                  ContentWidth(
                    child: ListTile(
                      onTap: () => context.push('/chat/${c.peerId}'),
                      contentPadding: const EdgeInsets.symmetric(horizontal: S.gutter, vertical: 4),
                      leading: Avatar(url: c.photo, name: c.name, size: 52, online: c.online),
                      title: Row(children: [
                        Expanded(
                          child: Text(c.name,
                              maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                        ),
                        Text(ago(c.lastAt ?? c.connectedAt),
                            style: TextStyle(fontSize: 11.5, color: c.unread > 0 ? C.brand : C.ink3, fontWeight: FontWeight.w600)),
                      ]),
                      subtitle: Row(children: [
                        Expanded(
                          child: Text(
                            c.lastBody != null ? '${c.lastFromMe ? 'You: ' : ''}${c.lastBody}' : 'New connection — say hello',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13.5,
                              color: c.unread > 0 ? C.ink : C.ink3,
                              fontWeight: c.unread > 0 ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                        ),
                        if (c.unread > 0) ...[const SizedBox(width: 8), CountBadge(c.unread)],
                      ]),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
