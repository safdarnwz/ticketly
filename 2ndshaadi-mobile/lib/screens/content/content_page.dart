import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/links.dart';
import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';

/// Pages admins edit: terms, privacy, safety, FAQ, about…
class ContentPageScreen extends ConsumerWidget {
  const ContentPageScreen({super.key, required this.slug});
  final String slug;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(contentPageProvider(slug));
    return Scaffold(
      appBar: AppBar(title: Text(str(data.value?['title']))),
      body: data.when(
        loading: () => ListView(padding: const EdgeInsets.all(S.gutter), children: const [
          Skeleton(height: 28, width: 220),
          SizedBox(height: 14),
          Skeleton(height: 14),
          SizedBox(height: 8),
          Skeleton(height: 14),
          SizedBox(height: 8),
          Skeleton(height: 14, width: 200),
        ]),
        error: (e, _) => e is ApiError && e.status == 404
            ? EmptyState(
                icon: Icons.description_outlined,
                title: 'This page does not exist',
                action: AppButton(label: 'Help and policies', variant: ButtonVariant.secondary, onPressed: () => context.pushReplacement('/help')),
              )
            : ErrorState(error: e, onRetry: () => ref.invalidate(contentPageProvider(slug))),
        data: (p) => ListView(
          padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 32),
          children: [
            ContentWidth(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(str(p['title']), style: Theme.of(context).textTheme.headlineSmall),
                if (str(p['summary']).isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(str(p['summary']), style: const TextStyle(fontSize: 16, color: C.ink2, height: 1.45)),
                ],
                if (dateN(p['updatedAt']) != null) ...[
                  const SizedBox(height: 6),
                  Text('Updated ${date(dateN(p['updatedAt']))}', style: const TextStyle(fontSize: 12.5, color: C.ink3)),
                ],
                const SizedBox(height: 18),
                MarkdownBody(
                  data: str(p['body']),
                  selectable: true,
                  onTapLink: (text, href, title) => openLink(context, href),
                  styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
                    p: const TextStyle(fontSize: 15.5, height: 1.6, color: C.ink),
                    h2: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600, height: 1.4),
                    h3: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w600, height: 1.4),
                    a: const TextStyle(color: C.brand, fontWeight: FontWeight.w600),
                    listBullet: const TextStyle(fontSize: 15.5, color: C.ink),
                    blockSpacing: 14,
                  ),
                ),
                if (slug == 'grievance') ...[
                  const SizedBox(height: 20),
                  AppButton(label: 'File or check a complaint', onPressed: () => context.push('/grievance')),
                ],
              ]),
            ),
          ],
        ),
      ),
    );
  }
}
