import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/links.dart';
import '../../app/theme.dart';
import '../../core/json.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';

/// Help, safety and policy pages, plus how to reach support.
class HelpScreen extends ConsumerWidget {
  const HelpScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final site = ref.watch(siteConfigProvider);
    final groups = [('HELP', 'Help and safety'), ('COMPANY', 'About us'), ('LEGAL', 'Legal')];
    final general = site.section('general');
    Widget card(List<Widget> children) => Container(
          decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(S.radius)),
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            for (var i = 0; i < children.length; i++) ...[if (i > 0) const Divider(indent: 16), children[i]],
          ]),
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Help and policies')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(siteProvider.future).then((_) {}, onError: (_) {}),
        child: ListView(
          padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 28),
          children: [
            ContentWidth(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final (g, label) in groups)
                  if (site.pages.any((p) => p.group == g)) ...[
                    GroupLabel(label),
                    card([
                      for (final p in site.pages.where((p) => p.group == g))
                        ListTile(
                          title: Text(p.title),
                          trailing: const Icon(Icons.chevron_right_rounded, color: C.ink3),
                          onTap: () => context.push('/page/${p.slug}'),
                        ),
                    ]),
                  ],
                const GroupLabel('Contact us'),
                card([
                  if (site.supportEmail.isNotEmpty)
                    ListTile(
                      leading: const Icon(Icons.mail_outline_rounded),
                      title: Text(site.supportEmail),
                      subtitle: const Text('Email support'),
                      onTap: () => launchExternal('mailto:${site.supportEmail}'),
                    ),
                  if (site.supportPhone.isNotEmpty)
                    ListTile(
                      leading: const Icon(Icons.call_outlined),
                      title: Text(site.supportPhone),
                      subtitle: Text(str(general['supportHours'], 'Call support')),
                      onTap: () => launchExternal('tel:${site.supportPhone.replaceAll(' ', '')}'),
                    ),
                  ListTile(
                    leading: const Icon(Icons.gavel_outlined),
                    title: const Text('Grievance officer'),
                    subtitle: const Text('File or check a complaint'),
                    trailing: const Icon(Icons.chevron_right_rounded, color: C.ink3),
                    onTap: () => context.push('/grievance'),
                  ),
                ]),
                if (str(general['companyName']).isNotEmpty) ...[
                  const SizedBox(height: 18),
                  Text(
                    [general['companyName'], general['companyAddress']].where((x) => str(x).isNotEmpty).join('\n'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: C.ink3),
                  ),
                ],
              ]),
            ),
          ],
        ),
      ),
    );
  }
}
