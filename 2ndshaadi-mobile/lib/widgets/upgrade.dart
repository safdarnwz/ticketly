import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/config.dart';
import '../app/theme.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/plans.dart';
import '../core/providers.dart';
import '../core/session.dart';
import 'common.dart';

/// Opens whenever the API reports a missing feature or a used-up limit (HTTP 402).
Future<void> showUpgradeSheet(BuildContext context, UpgradeEvent e) {
  return showAppSheet<void>(context, builder: (c) => _UpgradeSheet(event: e));
}

class _UpgradeSheet extends ConsumerWidget {
  const _UpgradeSheet({required this.event});
  final UpgradeEvent event;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalogue = ref.watch(catalogueProvider).value;
    final me = ref.watch(meProvider);
    final buy = AppConfig.canBuyInApp;
    final plan = catalogue == null || !buy ? null : cheapestWith(catalogue.plans, event.feature, me?.features);
    final t = Theme.of(context).textTheme;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.paddingOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.workspace_premium_rounded, size: 44, color: C.gold),
          const SizedBox(height: 10),
          Text(event.code == 'DAILY_LIMIT' ? 'Limit reached' : 'Upgrade to continue', style: t.titleLarge),
          const SizedBox(height: 8),
          Text(event.message, textAlign: TextAlign.center, style: t.bodyLarge?.copyWith(color: C.ink2)),
          if (plan != null && catalogue != null) ...[
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(border: Border.all(color: C.line), borderRadius: BorderRadius.circular(14)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(plan.name, style: t.titleMedium)),
                      Text(inr(plan.priceInr), style: t.titleMedium),
                      Text(' / ${durationText(plan.durationDays)}', style: t.bodySmall),
                    ],
                  ),
                  const SizedBox(height: 10),
                  for (final h in highlightsOf(plan, catalogue.features).take(5))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.check_rounded, size: 18, color: C.button),
                          const SizedBox(width: 8),
                          Expanded(child: Text(h, style: const TextStyle(fontSize: 14, color: C.ink))),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 18),
          if (buy)
            AppButton(
              label: plan != null ? 'Get ${plan.name}' : 'See plans',
              icon: Icons.workspace_premium_rounded,
              expand: true,
              onPressed: () {
                Navigator.pop(context);
                context.push(plan != null ? '/plans?plan=${plan.code}' : '/plans');
              },
            ),
          const SizedBox(height: 4),
          AppButton(
            label: buy ? 'Maybe later' : 'OK',
            variant: ButtonVariant.ghost,
            expand: true,
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
    );
  }
}
