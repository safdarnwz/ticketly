import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/config.dart';
import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/models.dart';
import '../../core/plans.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../core/tracker.dart';
import '../../widgets/common.dart';
import '../../widgets/photo.dart';
import 'razorpay.dart';

class PlansScreen extends ConsumerStatefulWidget {
  const PlansScreen({super.key, this.planCode});
  final String? planCode;
  @override
  ConsumerState<PlansScreen> createState() => _PlansScreenState();
}

class _PlansScreenState extends ConsumerState<PlansScreen> {
  bool _autoOpened = false;
  String? busy;

  Future<void> _choose(PlanOffer plan, Catalogue cat) async {
    final unavailable = ref.read(paymentProviderProvider).value == 'unavailable' || !ref.read(siteConfigProvider).module('payments');
    if (unavailable) return toast(context, 'Online payments are paused right now. Please try again a little later.', error: true);
    final consent = await showAppSheet<Json>(context, builder: (c) => _Checkout(plan: plan));
    if (consent == null || !mounted) return;
    setState(() => busy = plan.code);
    try {
      final order = asMap(await Api.instance.post('/payments/orders', {'plan': plan.code, 'consent': consent}));
      if (!mounted) return;
      if (boolean(order['testMode'])) {
        await _testPayment(order, plan);
        return;
      }
      final me = ref.read(meProvider);
      final site = ref.read(siteConfigProvider);
      final res = await payWithRazorpay({
        'key': str(order['keyId']),
        'order_id': str(order['orderId']),
        'amount': integer(order['amountPaise']),
        'currency': str(order['currency'], 'INR'),
        'name': site.siteName,
        'description': '${plan.name} membership · ${durationText(plan.durationDays)}',
        'prefill': {'contact': me?.phone ?? '', 'email': me?.email ?? ''},
        'theme': {'color': '#F26076'},
        'retry': {'enabled': true, 'max_count': 2},
      });
      if (res == null) {
        Tracker.instance.event('checkout_dismiss', {'plan': plan.code});
        return;
      }
      await Api.instance.post('/payments/verify', {'orderId': res.orderId, 'paymentId': res.paymentId, 'signature': res.signature});
      await _finish(plan.name);
    } on PaymentFailed catch (e) {
      Tracker.instance.event('payment_error');
      if (mounted) toast(context, e.message, error: true);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => busy = null);
    }
  }

  Future<void> _testPayment(Json order, PlanOffer plan) async {
    final yes = await confirm(
      context,
      title: 'Test payment',
      body:
          'Razorpay is not configured on this server, so this completes the order without charging anything (${inr(integer(order['amountPaise']) / 100)} · ${plan.name}). This is refused in production.',
      yes: 'Complete test payment',
    );
    if (!yes || !mounted) return;
    final ok = await runGuarded(context, () async => Api.instance.post('/payments/test-complete', {'orderId': str(order['orderId'])}));
    if (ok) await _finish(plan.name);
  }

  Future<void> _finish(String name) async {
    await ref.read(sessionProvider.notifier).reloadMe();
    ref.invalidate(usageProvider);
    if (!mounted) return;
    toast(context, 'Your $name membership is active. Thank you!');
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final data = ref.watch(catalogueProvider);
    final provider = ref.watch(paymentProviderProvider).value;
    final buy = AppConfig.canBuyInApp;
    final unavailable = provider == 'unavailable' || !ref.watch(siteConfigProvider).module('payments');

    final cat = data.value;
    if (cat != null && !_autoOpened && widget.planCode != null && buy) {
      _autoOpened = true;
      final p = cat.plans.where((x) => x.code == widget.planCode && !x.isFree).firstOrNull;
      if (p != null) WidgetsBinding.instance.addPostFrameCallback((_) => mounted ? _choose(p, cat) : null);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Membership')),
      body: data.when(
        skipLoadingOnRefresh: true,
        loading: () => const ListSkeleton(rows: 3, height: 300),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(catalogueProvider)),
        data: (cat) {
          final width = MediaQuery.sizeOf(context).width;
          final cols = width >= 1000 ? 3 : width >= 680 ? 2 : 1;
          return ListView(
            padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 28),
            children: [
              ContentWidth(
                max: 1100,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('Choose how you want to connect', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 6),
                  Text(
                    buy
                        ? 'Start free. Upgrade when you are ready to talk. One-time payment, no auto-renewal.'
                        : 'See what each membership includes.',
                    style: const TextStyle(color: C.ink2),
                  ),
                  const SizedBox(height: 14),
                  if (me != null && me.isPaid && me.planExpiresAt != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Notice(
                        'Active until ${date(me.planExpiresAt)}.${buy ? ' Buying again adds the time to your current membership.' : ''}',
                        title: 'You are a ${me.planName} member',
                        tone: PillTone.ok,
                        icon: Icons.verified_rounded,
                      ),
                    ),
                  if (buy && unavailable)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 12),
                      child: Notice('Online payments are paused right now. Please try again a little later.'),
                    ),
                  LayoutBuilder(builder: (context, box) {
                    final w = (box.maxWidth - (cols - 1) * 12) / cols;
                    return Wrap(spacing: 12, runSpacing: 12, children: [
                      for (final p in cat.plans)
                        SizedBox(
                          width: w,
                          child: _PlanCard(
                            plan: p,
                            cat: cat,
                            current: (me?.plan ?? 'FREE') == p.code,
                            busy: busy == p.code,
                            onChoose: buy && !p.isFree ? () => _choose(p, cat) : null,
                          ),
                        ),
                    ]);
                  }),
                  const SizedBox(height: 22),
                  Text('Compare every feature', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 10),
                  _Compare(cat: cat),
                  const SizedBox(height: 16),
                  for (final (t, b) in const [
                    ('No auto-renewal', 'You pay once for a fixed period. We never charge you again without asking.'),
                    ('Days carry over', 'Buying again before your plan ends adds the new days on top.'),
                    ('Secure payment', 'Cards, UPI and net banking through Razorpay. We never see your card details.'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: SectionCard(
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Icon(Icons.verified_user_outlined, color: C.brand),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(t, style: const TextStyle(fontWeight: FontWeight.w600)),
                              Text(b, style: const TextStyle(color: C.ink2, fontSize: 13.5)),
                            ]),
                          ),
                        ]),
                      ),
                    ),
                  Wrap(alignment: WrapAlignment.center, children: [
                    TextButton(onPressed: () => context.push('/page/refund-policy'), child: const Text('Refund policy')),
                    TextButton(onPressed: () => context.push('/page/terms'), child: const Text('Terms')),
                  ]),
                ]),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.cat, required this.current, required this.busy, this.onChoose});
  final PlanOffer plan;
  final Catalogue cat;
  final bool current, busy;
  final VoidCallback? onChoose;
  @override
  Widget build(BuildContext context) {
    final perMonth = plan.durationDays >= 60 ? (plan.priceInr * 30 / plan.durationDays).round() : null;
    final off = plan.mrpInr != null && plan.mrpInr! > 0 ? ((plan.mrpInr! - plan.priceInr) / plan.mrpInr! * 100).round() : 0;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: C.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: plan.isPopular ? C.button : current ? C.ink3 : C.line, width: plan.isPopular || current ? 2 : 1),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (!plan.isFree) const Padding(padding: EdgeInsets.only(right: 6), child: Icon(Icons.workspace_premium_rounded, color: C.gold)),
          Flexible(child: Text(plan.name, style: Theme.of(context).textTheme.titleLarge)),
          if (plan.badgeTone != 'none' && plan.features.premiumBadge) ...[
            const SizedBox(width: 6),
            PlanBadge(PlanBadgeInfo(plan.name, plan.badgeTone)),
          ],
          const Spacer(),
          if (current) const Pill('Your plan') else if (plan.isPopular) const Pill('Most popular', tone: PillTone.love),
        ]),
        if (plan.tagline.isNotEmpty) Text(plan.tagline, style: const TextStyle(color: C.ink2, fontSize: 13.5)),
        const SizedBox(height: 12),
        if (plan.isFree)
          const Text('₹0', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w600))
        else ...[
          Text.rich(TextSpan(children: [
            TextSpan(text: inr(plan.priceInr), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w600)),
            TextSpan(text: ' / ${durationText(plan.durationDays)}', style: const TextStyle(color: C.ink3)),
          ])),
          Wrap(spacing: 8, children: [
            if (plan.mrpInr != null)
              Text(inr(plan.mrpInr!), style: const TextStyle(color: C.ink3, decoration: TextDecoration.lineThrough)),
            if (off > 0) Text('$off% off', style: const TextStyle(color: C.ok, fontWeight: FontWeight.w600)),
            if (perMonth != null) Text('≈ ${inr(perMonth)} a month', style: const TextStyle(color: C.ink3)),
          ]),
        ],
        const SizedBox(height: 12),
        for (final h in highlightsOf(plan, cat.features))
          Padding(
            padding: const EdgeInsets.only(bottom: 7),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.check_rounded, size: 18, color: C.button),
              const SizedBox(width: 8),
              Expanded(child: Text(h, style: const TextStyle(fontSize: 14))),
            ]),
          ),
        if (onChoose != null) ...[
          const SizedBox(height: 8),
          AppButton(
            label: '${current ? 'Extend' : 'Choose'} ${plan.name}',
            expand: true,
            loading: busy,
            variant: plan.isPopular ? ButtonVariant.primary : ButtonVariant.secondary,
            onPressed: onChoose,
          ),
        ],
      ]),
    );
  }
}

class _Compare extends StatelessWidget {
  const _Compare({required this.cat});
  final Catalogue cat;
  @override
  Widget build(BuildContext context) {
    Widget value(FeatureDef d, PlanOffer p) {
      final v = p.features.raw[d.key];
      if (d.type == 'flag' || v is bool) {
        return p.features.flag(d.key)
            ? const Icon(Icons.check_rounded, color: C.brand, size: 20)
            : const Icon(Icons.remove_rounded, color: C.lineStrong, size: 20);
      }
      return Text(limitText(p.features.limit(d.key), d.unit),
          textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600));
    }

    return Container(
      decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(14)),
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: ConstrainedBox(
          constraints: BoxConstraints(minWidth: MediaQuery.sizeOf(context).width - 2 * S.gutter - 2),
          child: Table(
            defaultColumnWidth: const FixedColumnWidth(92),
            columnWidths: const {0: FixedColumnWidth(190)},
            defaultVerticalAlignment: TableCellVerticalAlignment.middle,
            children: [
              TableRow(
                decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.line))),
                children: [
                  const Padding(padding: EdgeInsets.all(12), child: Text('Feature', style: TextStyle(color: C.ink3, fontWeight: FontWeight.w600))),
                  for (final p in cat.plans)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(p.name, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                ],
              ),
              for (final (g, label) in featureGroups) ...[
                if (cat.features.values.any((d) => d.group == g))
                  TableRow(
                    decoration: const BoxDecoration(color: C.sunk),
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Text(label.toUpperCase(),
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: C.ink2, letterSpacing: 0.6)),
                      ),
                      for (final _ in cat.plans) const SizedBox.shrink(),
                    ],
                  ),
                for (final d in cat.features.values.where((d) => d.group == g))
                  TableRow(
                    decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.line))),
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(d.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          if (d.hint.isNotEmpty) Text(d.hint, style: const TextStyle(fontSize: 11.5, color: C.ink3)),
                        ]),
                      ),
                      for (final p in cat.plans) Center(child: value(d, p)),
                    ],
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Before paying: the plan, and whether to share contact details with members.
class _Checkout extends ConsumerStatefulWidget {
  const _Checkout({required this.plan});
  final PlanOffer plan;
  @override
  ConsumerState<_Checkout> createState() => _CheckoutState();
}

class _CheckoutState extends ConsumerState<_Checkout> {
  late final Map<String, bool> consent = () {
    final p = ref.read(meProvider)?.privacy ?? const PrivacySettings();
    return {
      'sharePhoneWithPaid': p.sharePhoneWithPaid,
      'sharePhoneWithFree': p.sharePhoneWithFree,
      'shareEmailWithPaid': p.shareEmailWithPaid,
      'shareEmailWithFree': p.shareEmailWithFree,
    };
  }();

  @override
  Widget build(BuildContext context) {
    final plan = widget.plan;
    final hasEmail = ref.watch(meProvider)?.email != null;
    Widget yesNo(String key, String label) => ToggleRow(
          label: label,
          value: consent[key] ?? false,
          onChanged: (v) => setState(() => consent[key] = v),
        );
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.paddingOf(context).bottom),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('Get ${plan.name}', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: C.sunk, borderRadius: BorderRadius.circular(12)),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(plan.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text('${durationText(plan.durationDays)} · one-time payment', style: const TextStyle(color: C.ink3, fontSize: 13)),
              ]),
            ),
            Text(inr(plan.priceInr), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
          ]),
        ),
        const SizedBox(height: 16),
        const Row(children: [
          Icon(Icons.lock_outline_rounded, size: 18, color: C.gold),
          SizedBox(width: 6),
          Text('Your contact details', style: TextStyle(fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 4),
        const Text(
          'Paid members can unlock contact details of people who agree to share them. Do you want to share yours? You can change this any time in Settings.',
          style: TextStyle(color: C.ink2, fontSize: 13.5),
        ),
        yesNo('sharePhoneWithPaid', 'Share my mobile number with paid members'),
        yesNo('sharePhoneWithFree', 'Share my mobile number with free members'),
        if (hasEmail) ...[
          yesNo('shareEmailWithPaid', 'Share my email with paid members'),
          yesNo('shareEmailWithFree', 'Share my email with free members'),
        ],
        const SizedBox(height: 14),
        AppButton(label: 'Pay ${inr(plan.priceInr)}', expand: true, onPressed: () => Navigator.pop(context, consent)),
        const SizedBox(height: 6),
        const Center(
          child: Text('By paying you agree to our terms and refund policy.', style: TextStyle(fontSize: 12, color: C.ink3)),
        ),
      ]),
    );
  }
}
