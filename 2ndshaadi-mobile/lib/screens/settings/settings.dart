import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import '../../app/config.dart';
import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/local_notify.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/photo.dart';

final _payments = FutureProvider.autoDispose<List<Json>>((ref) async {
  ref.watch(accountKeyProvider);
  final r = await Api.instance.get('/payments/history');
  return r is List ? r.map(asMap).toList() : <Json>[];
});
final _blocks = FutureProvider.autoDispose<List<Json>>((ref) async {
  ref.watch(accountKeyProvider);
  final r = await Api.instance.get('/blocks');
  return r is List ? r.map(asMap).toList() : <Json>[];
});
final _ignored = FutureProvider.autoDispose<List<Json>>((ref) async {
  ref.watch(accountKeyProvider);
  final r = await Api.instance.get('/profiles/ignored');
  return r is List ? r.map(asMap).toList() : <Json>[];
});
final _devices = FutureProvider.autoDispose<List<Json>>((ref) async {
  ref.watch(accountKeyProvider);
  final r = await Api.instance.get('/auth/devices');
  return r is List ? r.map(asMap).toList() : <Json>[];
});

const _journey = [
  ('ACTIVE', 'Looking for a partner'),
  ('MARRIAGE_FIXED', 'My marriage is fixed'),
  ('MARRIED', 'I got married'),
  ('NOT_LOOKING', 'Not looking now'),
  ('TAKING_BREAK', 'Taking a break'),
];

const _leaving = {
  'MARRIED_VIA_SITE': 'I found my partner on 2ndShaadi',
  'MARRIED_ELSEWHERE': 'I found my partner elsewhere',
  'NOT_LOOKING': 'I am not looking any more',
  'NOT_HAPPY': 'I did not like the service',
  'PRIVACY': 'Privacy concerns',
  'TOO_EXPENSIVE': 'Plans are too expensive',
  'OTHER': 'Something else',
};

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool saving = false;

  Future<void> _save(Json patch) async {
    if (saving) return;
    setState(() => saving = true);
    final ok = await runGuarded(context, () async => Api.instance.patch('/users/me/settings', patch));
    await ref.read(sessionProvider.notifier).reloadMe();
    if (!mounted) return;
    setState(() => saving = false);
    if (ok) toast(context, 'Saved');
  }

  Widget _locked() => const Pill('Paid plans', tone: PillTone.gold, icon: Icons.lock_rounded);

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    if (me == null) return const Scaffold();
    final p = me.privacy;
    final site = ref.watch(siteConfigProvider);
    final usage = ref.watch(usageProvider).value;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings and privacy')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 28),
        children: [
          ContentWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionCard(
                  child: Row(children: [
                    Photo(url: me.photo, name: me.displayName, size: 56),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(me.name.isEmpty ? me.displayName : me.name,
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleMedium),
                        Text(phone(me.phone) ?? me.email ?? '', style: const TextStyle(color: C.ink2, fontSize: 13.5)),
                      ]),
                    ),
                    Pill(me.planName, tone: me.isPaid ? PillTone.gold : PillTone.neutral),
                  ]),
                ),

                const GroupLabel('Membership and status'),
                SectionCard(
                  title: 'Membership',
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${me.planName} plan', style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                      me.isPaid && me.planExpiresAt != null
                          ? 'Active until ${date(me.planExpiresAt)}'
                          : 'Upgrade to message matches and see contact details.',
                      style: const TextStyle(color: C.ink2),
                    ),
                    if (usage != null) ...[const SizedBox(height: 12), _UsageMeters(usage: usage)],
                    if (AppConfig.canBuyInApp) ...[
                      const SizedBox(height: 12),
                      AppButton(
                        label: me.isPaid ? 'Extend' : 'Upgrade',
                        dense: true,
                        variant: me.isPaid ? ButtonVariant.secondary : ButtonVariant.primary,
                        onPressed: () => context.push('/plans'),
                      ),
                    ],
                    const _Payments(),
                  ]),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Your status',
                  hint: 'Found someone, or taking a break? Choose a status and your profile is hidden from everyone at once.',
                  child: _Journey(me: me),
                ),

                const GroupLabel('Privacy'),
                SectionCard(
                  title: 'Who can message me',
                  hint: 'Only connections (an accepted interest) can ever message you. Blocked members can never write again.',
                  child: Column(children: [
                    ToggleRow(
                      label: 'Members on the free plan',
                      value: p.acceptChatsFromFree,
                      enabled: !saving,
                      locked: me.features.chatControls ? null : _locked(),
                      onChanged: (v) => _save({'acceptChatsFromFree': v}),
                    ),
                    ToggleRow(
                      label: 'Members on paid plans',
                      value: p.acceptChatsFromPaid,
                      enabled: !saving,
                      locked: me.features.chatControls ? null : _locked(),
                      onChanged: (v) => _save({'acceptChatsFromPaid': v}),
                    ),
                  ]),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Who can see my contact details',
                  hint:
                      'Your mobile number and email stay hidden unless you say yes here. Members also need a plan that includes contact details.',
                  child: Column(children: [
                    if (!site.module('contactSharing'))
                      const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Notice('Contact sharing is paused for everyone right now.'),
                      ),
                    ToggleRow(
                      label: 'Paid members can see my mobile number',
                      value: p.sharePhoneWithPaid,
                      enabled: !saving,
                      onChanged: (v) => _save({'sharePhoneWithPaid': v}),
                    ),
                    ToggleRow(
                      label: 'Free members can see my mobile number',
                      value: p.sharePhoneWithFree,
                      enabled: !saving,
                      onChanged: (v) => _save({'sharePhoneWithFree': v}),
                    ),
                    if (me.email != null) ...[
                      ToggleRow(
                        label: 'Paid members can see my email',
                        value: p.shareEmailWithPaid,
                        enabled: !saving,
                        onChanged: (v) => _save({'shareEmailWithPaid': v}),
                      ),
                      ToggleRow(
                        label: 'Free members can see my email',
                        value: p.shareEmailWithFree,
                        enabled: !saving,
                        onChanged: (v) => _save({'shareEmailWithFree': v}),
                      ),
                    ],
                  ]),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Who can see my profile',
                  hint: 'Your connections can always see your profile.',
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ToggleRow(
                      label: 'Members on paid plans',
                      description: 'They can find you in search and open your profile.',
                      value: p.visibleToPaid,
                      enabled: !saving && !(p.visibleToPaid && !p.visibleToFree),
                      onChanged: (v) => _save({'visibleToPaid': v}),
                    ),
                    ToggleRow(
                      label: 'Members on the free plan',
                      description: p.visibleToFree ? null : 'Free members are asked to upgrade to see your profile.',
                      value: p.visibleToFree,
                      enabled: !saving && !(p.visibleToFree && !p.visibleToPaid),
                      onChanged: (v) => _save({'visibleToFree': v}),
                    ),
                    TextButton.icon(
                      onPressed: () => context.push('/edit-profile'),
                      icon: const Icon(Icons.visibility_off_outlined, size: 18),
                      label: Text(me.isHidden ? 'Hidden from search · Show it again' : 'Hide my profile from search'),
                    ),
                  ]),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Who can see my photos',
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ChoiceChips<String>(
                      options: const [('ALL', 'Everyone'), ('PAID', 'Paid members'), ('CONNECTIONS', 'Only my connections')],
                      selected: {p.photoVisibility},
                      enabled: !saving,
                      onChanged: (v) {
                        if (v.isNotEmpty && v.first != p.photoVisibility) _save({'photoVisibility': v.first});
                      },
                    ),
                    const FieldHint('Others see a placeholder with your initials until they are allowed to see your photos.'),
                  ]),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Activity',
                  child: Column(children: [
                    ToggleRow(
                      label: 'Show when I am online',
                      description: 'Members who can see online status see “Online” or when you were last active.',
                      value: me.showOnlineStatus,
                      enabled: !saving,
                      onChanged: (v) => _save({'showOnlineStatus': v}),
                    ),
                    ToggleRow(
                      label: 'Private browsing',
                      description: 'Open profiles without appearing in their “Who viewed me” list.',
                      value: p.incognito && me.features.incognito,
                      enabled: !saving,
                      locked: me.features.incognito ? null : _locked(),
                      onChanged: (v) => _save({'incognito': v}),
                    ),
                  ]),
                ),

                if (!kIsWeb) ...[
                  const GroupLabel('App permissions'),
                  const _Permissions(),
                ],

                const GroupLabel('Hidden and blocked'),
                const _Hidden(),
                const SizedBox(height: 12),
                const _Blocked(),

                const GroupLabel('Sign-in and security'),
                const _Devices(),

                const GroupLabel('Your data'),
                const _DataExport(),
                const SizedBox(height: 12),
                _Nominee(me: me),
                const SizedBox(height: 12),
                SectionCard(
                  danger: true,
                  title: 'Delete account',
                  hint:
                      'Your profile is hidden at once and everything is deleted within ${integer(site.section('accountRules')['deletionWorkingDays'], 2)} working days. You can cancel by signing in before then.',
                  child: AppButton(
                    label: 'Delete my account',
                    variant: ButtonVariant.danger,
                    dense: true,
                    onPressed: () => showAppSheet<void>(context, builder: (_) => _DeleteSheet(isPaid: me.isPaid)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _UsageMeters extends StatelessWidget {
  const _UsageMeters({required this.usage});
  final Usage usage;
  @override
  Widget build(BuildContext context) {
    final f = usage.features;
    Widget meter(String label, int? left, int total) {
      if (total == 0) return const SizedBox.shrink();
      final unlimited = left == null || total == -1;
      final used = unlimited ? 0 : (total - left).clamp(0, total);
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 13, color: C.ink2))),
            Text(unlimited ? 'Unlimited' : '$used of $total used',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: C.ink)),
          ]),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: LinearProgressIndicator(
              value: unlimited ? 0 : (total > 0 ? used / total : 0),
              minHeight: 6,
              backgroundColor: C.sunk,
              color: C.button,
            ),
          ),
        ]),
      );
    }

    return Column(children: [
      meter('Profile views today', usage.remainingProfileViews, f.profileViewsPerDay),
      meter('Interests today', usage.remainingInterests, f.interestsPerDay),
      meter('Contact details (30 days)', usage.remainingContactViews, f.contactViewsPerMonth),
    ]);
  }
}

class _Payments extends ConsumerWidget {
  const _Payments();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = (ref.watch(_payments).value ?? const <Json>[]).where((x) => x['status'] == 'SUCCESS').toList();
    if (list.isEmpty) return const SizedBox.shrink();
    Future<void> download(String path, String name) async {
      await runGuarded(context, () async {
        final (bytes, fileName) = await Api.instance.download(path);
        await shareFile(bytes, fileName ?? name, 'application/pdf');
      });
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 16),
      const Text('Payments', style: TextStyle(fontWeight: FontWeight.w600, color: C.ink2)),
      for (final x in list)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${str(x['planName'], str(x['plan']))} · ${inr(integer(x['amountPaise']) / 100)}',
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(date(dateN(x['paidAt']) ?? dateN(x['createdAt'])), style: const TextStyle(fontSize: 12.5, color: C.ink3)),
              ]),
            ),
            if (x['invoiceNumber'] != null) ...[
              TextButton(
                onPressed: () => download('/payments/${x['id']}/invoice.pdf', 'invoice.pdf'),
                child: const Text('Invoice'),
              ),
              TextButton(
                onPressed: () => download('/payments/${x['id']}/plan.pdf', 'plan-details.pdf'),
                child: const Text('Plan'),
              ),
            ] else
              const Text('Invoice being prepared', style: TextStyle(fontSize: 12, color: C.ink3)),
          ]),
        ),
    ]);
  }
}

class _Journey extends ConsumerStatefulWidget {
  const _Journey({required this.me});
  final Me me;
  @override
  ConsumerState<_Journey> createState() => _JourneyState();
}

class _JourneyState extends ConsumerState<_Journey> {
  bool busy = false;
  Future<void> _set(String status, {bool metOnSite = false}) async {
    if (busy) return;
    setState(() => busy = true);
    final ok = await runGuarded(context, () async {
      await Api.instance.patch('/profiles/me/journey', {'status': status, if (metOnSite) 'metOnSite': true});
    });
    await ref.read(sessionProvider.notifier).reloadMe();
    if (!mounted) return;
    setState(() => busy = false);
    if (ok) {
      toast(context, metOnSite
          ? 'Congratulations! Thank you for telling us.'
          : status == 'ACTIVE'
              ? 'Your profile is visible again'
              : 'Your profile is now hidden from everyone');
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.me.journeyStatus;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ChoiceChips<String>(
        options: _journey,
        selected: {s},
        enabled: !busy,
        onChanged: (v) {
          if (v.isNotEmpty && v.first != s) _set(v.first);
        },
      ),
      if (s != 'ACTIVE') ...[
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: C.sunk, borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Your profile is hidden from everyone, including your connections.',
                style: TextStyle(fontWeight: FontWeight.w600)),
            if (s == 'MARRIAGE_FIXED' || s == 'MARRIED')
              TextButton(onPressed: () => _set(s, metOnSite: true), child: const Text('Congratulations! We met on 2ndShaadi')),
          ]),
        ),
      ],
    ]);
  }
}

/// Camera, photos, location and notifications: what is allowed, and a way to change it.
class _Permissions extends StatefulWidget {
  const _Permissions();
  @override
  State<_Permissions> createState() => _PermissionsState();
}

class _PermissionsState extends State<_Permissions> with WidgetsBindingObserver {
  bool? notifications;
  LocationPermission? location;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back from the phone's Settings: show the new state.
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    final n = await LocalNotify.instance.enabled();
    LocationPermission? l;
    try {
      l = await Geolocator.checkPermission();
    } catch (_) {}
    if (mounted) {
      setState(() {
        notifications = n;
        location = l;
      });
    }
  }

  Future<void> _openSettings() async {
    try {
      await Geolocator.openAppSettings();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final locOn = location == LocationPermission.always || location == LocationPermission.whileInUse;
    Widget row(IconData icon, String title, String body, bool? on, VoidCallback onTap) => ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(icon, color: C.ink2),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w500)),
          subtitle: Text(body, style: const TextStyle(fontSize: 12.5, color: C.ink3)),
          trailing: on == null
              ? null
              : TextButton(onPressed: onTap, child: Text(on ? 'Allowed' : 'Allow')),
        );
    return SectionCard(
      hint: 'Each is asked only when you use it, and you can change it any time.',
      child: Column(children: [
        row(Icons.notifications_outlined, 'Notifications', 'New interests, connections and messages.', notifications, () async {
          final ok = await LocalNotify.instance.request();
          if (!ok) await _openSettings();
          _check();
        }),
        row(Icons.location_on_outlined, 'Location', 'Only to fill in your city and state, when you tap “Use my current location”.',
            location == null ? null : locOn, () async {
          if (location == LocationPermission.denied) {
            await Geolocator.requestPermission();
          } else {
            await _openSettings();
          }
          _check();
        }),
        row(Icons.photo_camera_outlined, 'Camera and photos', 'To add profile photos. Asked when you add a photo.', null, _openSettings),
        row(Icons.call_outlined, 'Calls and SMS', 'Calling or texting a revealed number opens your phone’s dialer or messages app.',
            null, _openSettings),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _openSettings,
            icon: const Icon(Icons.settings_outlined, size: 18),
            label: const Text('Open phone settings for 2ndShaadi'),
          ),
        ),
      ]),
    );
  }
}

class _Hidden extends ConsumerWidget {
  const _Hidden();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_ignored);
    return SectionCard(
      title: 'Not interested',
      hint: 'Members you hid from your results.',
      child: data.when(
        loading: () => const Skeleton(height: 44),
        error: (e, _) => TextButton(onPressed: () => ref.invalidate(_ignored), child: const Text('Could not load. Try again')),
        data: (list) => list.isEmpty
            ? const Text('Nobody hidden.', style: TextStyle(color: C.ink3))
            : Column(children: [
                for (final b in list)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Avatar(url: null, name: str(b['name']), size: 40),
                    title: Text(str(b['name'])),
                    subtitle: Text([b['age'], b['city']].where((x) => x != null).join(' · ')),
                    trailing: TextButton(
                      onPressed: () async {
                        final ok = await runGuarded(context, () async => Api.instance.delete('/profiles/${b['userId']}/ignore'));
                        ref.invalidate(_ignored);
                        ref.invalidate(searchProvider);
                        if (ok && context.mounted) toast(context, 'They will appear in your results again');
                      },
                      child: const Text('Show again'),
                    ),
                  ),
              ]),
      ),
    );
  }
}

class _Blocked extends ConsumerWidget {
  const _Blocked();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_blocks);
    return SectionCard(
      title: 'Blocked members',
      child: data.when(
        loading: () => const Skeleton(height: 44),
        error: (e, _) => TextButton(onPressed: () => ref.invalidate(_blocks), child: const Text('Could not load. Try again')),
        data: (list) => list.isEmpty
            ? const Text('You have not blocked anyone.', style: TextStyle(color: C.ink3))
            : Column(children: [
                for (final b in list)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Avatar(url: strN(b['photo']), name: str(b['name']), size: 40),
                    title: Text(str(b['name'])),
                    trailing: TextButton(
                      onPressed: () async {
                        final ok = await runGuarded(context, () async => Api.instance.delete('/blocks/${b['userId']}'));
                        ref.invalidate(_blocks);
                        if (ok && context.mounted) toast(context, 'Unblocked');
                      },
                      child: const Text('Unblock'),
                    ),
                  ),
              ]),
      ),
    );
  }
}

class _Devices extends ConsumerStatefulWidget {
  const _Devices();
  @override
  ConsumerState<_Devices> createState() => _DevicesState();
}

class _DevicesState extends ConsumerState<_Devices> {
  String? busy;
  @override
  Widget build(BuildContext context) {
    final data = ref.watch(_devices);
    return SectionCard(
      title: 'Where you are signed in',
      hint: 'Phones and computers signed in to your account. Signing a device out takes effect at once.',
      child: data.when(
        loading: () => const Column(children: [Skeleton(height: 52), SizedBox(height: 8), Skeleton(height: 52)]),
        error: (e, _) => TextButton(onPressed: () => ref.invalidate(_devices), child: const Text('Could not load your devices. Try again')),
        data: (list) {
          final others = list.where((d) => d['current'] != true).length;
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final d in list)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  RegExp(r'iPhone|iPad|Android|app').hasMatch(str(d['device'])) ? Icons.smartphone_rounded : Icons.computer_rounded,
                  color: C.ink3,
                ),
                title: Row(children: [
                  Flexible(child: Text(str(d['device']), style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14))),
                  if (d['current'] == true) ...[const SizedBox(width: 6), const Pill('This device', tone: PillTone.ok)],
                ]),
                subtitle: Text(
                  [
                    d['current'] == true
                        ? 'Active now'
                        : dateN(d['lastSeenAt']) != null
                            ? 'Last active ${ago(dateN(d['lastSeenAt']))}'
                            : null,
                    if (str(d['ip']) != 'unknown' && str(d['ip']).isNotEmpty) 'network ${d['ip']}',
                    dateN(d['createdAt']) != null ? 'signed in ${ago(dateN(d['createdAt']))}' : 'signed in earlier',
                  ].whereType<String>().join(' · '),
                  style: const TextStyle(fontSize: 12),
                ),
                trailing: d['current'] == true
                    ? null
                    : TextButton(
                        onPressed: busy != null
                            ? null
                            : () async {
                                setState(() => busy = str(d['id']));
                                final ok = await runGuarded(
                                    context, () async => Api.instance.post('/auth/devices/${Uri.encodeComponent(str(d['id']))}/sign-out'));
                                ref.invalidate(_devices);
                                if (!mounted) return;
                                setState(() => busy = null);
                                if (ok && context.mounted) toast(context, 'That device is signed out.');
                              },
                        child: Text(busy == str(d['id']) ? '…' : 'Sign out'),
                      ),
              ),
            if (others > 0)
              AppButton(
                label: 'Sign out of all other devices',
                variant: ButtonVariant.secondary,
                dense: true,
                loading: busy == 'all',
                onPressed: () async {
                  if (!await confirm(context,
                      title: 'Sign out of ${plural(others, 'other device')}?', body: 'This phone stays signed in.', yes: 'Sign out', danger: true)) {
                    return;
                  }
                  if (!context.mounted) return;
                  setState(() => busy = 'all');
                  await runGuarded(context, () async {
                    final r = asMap(await Api.instance.post('/auth/devices/sign-out-others'));
                    final n = integer(r['signedOut']);
                    if (context.mounted) {
                      toast(context, n > 0 ? 'Signed out of ${plural(n, 'other device')}.' : 'No other devices were signed in.');
                    }
                  });
                  ref.invalidate(_devices);
                  if (mounted) setState(() => busy = null);
                },
              ),
            const SizedBox(height: 8),
            const Text('Do not recognise a device? Sign it out. We also tell you whenever your account is signed in somewhere new.',
                style: TextStyle(fontSize: 12, color: C.ink3)),
            const SizedBox(height: 10),
            AppButton(
              label: 'Log out of this phone',
              icon: Icons.logout_rounded,
              variant: ButtonVariant.secondary,
              dense: true,
              onPressed: () async {
                if (await confirm(context, title: 'Log out of 2ndShaadi?', yes: 'Log out')) {
                  await ref.read(sessionProvider.notifier).signOut();
                }
              },
            ),
          ]);
        },
      ),
    );
  }
}

class _DataExport extends StatefulWidget {
  const _DataExport();
  @override
  State<_DataExport> createState() => _DataExportState();
}

class _DataExportState extends State<_DataExport> {
  bool busy = false;
  @override
  Widget build(BuildContext context) => SectionCard(
        title: 'Your data',
        hint: 'A JSON file with your profile, preferences, interests, messages you sent and payments.',
        child: Row(children: [
          AppButton(
            label: 'Download my data',
            variant: ButtonVariant.secondary,
            dense: true,
            loading: busy,
            onPressed: () async {
              setState(() => busy = true);
              await runGuarded(context, () async {
                final data = await Api.instance.get('/users/me/export');
                final bytes = utf8.encode(const JsonEncoder.withIndent('  ').convert(data));
                final day = DateTime.now().toIso8601String().substring(0, 10);
                await shareFile(bytes, '2ndshaadi-my-data-$day.json', 'application/json');
              });
              if (mounted) setState(() => busy = false);
            },
          ),
          const SizedBox(width: 8),
          TextButton(onPressed: () => context.push('/page/privacy'), child: const Text('Privacy policy')),
        ]),
      );
}

class _Nominee extends ConsumerStatefulWidget {
  const _Nominee({required this.me});
  final Me me;
  @override
  ConsumerState<_Nominee> createState() => _NomineeState();
}

class _NomineeState extends ConsumerState<_Nominee> {
  late final _name = TextEditingController(text: widget.me.nominee?.name ?? '');
  late final _rel = TextEditingController(text: widget.me.nominee?.relation ?? '');
  late final _contact = TextEditingController(text: widget.me.nominee?.contact ?? '');
  bool busy = false;

  @override
  void dispose() {
    _name.dispose();
    _rel.dispose();
    _contact.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SectionCard(
        title: 'Nominee',
        hint: 'Under the DPDP Act you can name a person who may exercise your data rights if you die or are unable to.',
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const FieldLabel('Name'),
          TextField(controller: _name, maxLength: 100, onChanged: (_) => setState(() {}), decoration: const InputDecoration(counterText: '')),
          const SizedBox(height: 10),
          const FieldLabel('Relation'),
          TextField(controller: _rel, maxLength: 40, decoration: const InputDecoration(counterText: '', hintText: 'e.g. Brother')),
          const SizedBox(height: 10),
          const FieldLabel('Phone or email'),
          TextField(controller: _contact, maxLength: 254, decoration: const InputDecoration(counterText: '')),
          const SizedBox(height: 10),
          AppButton(
            label: _name.text.trim().isEmpty ? 'Remove nominee' : 'Save nominee',
            variant: ButtonVariant.secondary,
            dense: true,
            loading: busy,
            onPressed: () async {
              setState(() => busy = true);
              final ok = await runGuarded(context, () async {
                await Api.instance.put('/users/me/nominee', {
                  'name': _name.text.trim(),
                  'relation': _rel.text.trim(),
                  'contact': _contact.text.trim(),
                });
              });
              await ref.read(sessionProvider.notifier).reloadMe();
              if (!mounted) return;
              setState(() => busy = false);
              if (ok && context.mounted) toast(context, _name.text.trim().isEmpty ? 'Nominee removed' : 'Nominee saved');
            },
          ),
        ]),
      );
}

class _DeleteSheet extends ConsumerStatefulWidget {
  const _DeleteSheet({required this.isPaid});
  final bool isPaid;
  @override
  ConsumerState<_DeleteSheet> createState() => _DeleteSheetState();
}

class _DeleteSheetState extends ConsumerState<_DeleteSheet> {
  String reason = 'MARRIED_VIA_SITE';
  int rating = 0;
  final _feedback = TextEditingController();
  final _confirm = TextEditingController();
  bool busy = false;

  @override
  void dispose() {
    _feedback.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final days = integer(ref.watch(siteConfigProvider).section('accountRules')['deletionWorkingDays'], 2);
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.paddingOf(context).bottom),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('Delete your account?', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          'Your profile is hidden straight away and your account is permanently deleted within $days working days: profile, photos, interests and messages. Sign in before then if you change your mind.${widget.isPaid ? ' Your remaining paid membership will be lost and is not refundable.' : ''}',
          style: const TextStyle(color: C.ink2),
        ),
        const SizedBox(height: 14),
        PickerField(
          label: 'Why are you leaving?',
          value: _leaving[reason],
          onTap: () async {
            final v = await pickOne<String>(context,
                title: 'Why are you leaving?', options: [for (final e in _leaving.entries) (e.key, e.value)], current: reason);
            if (v != null) setState(() => reason = v);
          },
        ),
        const SizedBox(height: 12),
        const FieldLabel('How was your experience?'),
        Row(children: [
          for (var n = 1; n <= 5; n++)
            IconButton(
              tooltip: '$n star${n > 1 ? 's' : ''}',
              onPressed: () => setState(() => rating = n),
              icon: Icon(Icons.star_rounded, size: 32, color: n <= rating ? C.gold : C.lineStrong),
            ),
        ]),
        const FieldLabel('Anything we should improve?', optional: true),
        TextField(controller: _feedback, minLines: 2, maxLines: 5, maxLength: 2000),
        const FieldLabel('Type DELETE to confirm'),
        TextField(controller: _confirm, autocorrect: false, onChanged: (_) => setState(() {})),
        const SizedBox(height: 16),
        AppButton(
          label: 'Delete my account',
          variant: ButtonVariant.danger,
          expand: true,
          loading: busy,
          onPressed: _confirm.text.trim().toUpperCase() != 'DELETE'
              ? null
              : () async {
                  setState(() => busy = true);
                  final ok = await runGuarded(context, () async {
                    final r = asMap(await Api.instance.delete('/users/me', {
                      'confirmation': _confirm.text.trim(),
                      'reason': reason,
                      if (rating > 0) 'rating': rating,
                      if (_feedback.text.trim().isNotEmpty) 'feedback': _feedback.text.trim(),
                    }));
                    final when = dateN(r['scheduledFor']);
                    if (context.mounted) {
                      Navigator.pop(context);
                      toast(context, 'Your profile is hidden. Your account will be deleted by ${date(when)}.');
                    }
                  });
                  if (ok) {
                    await ref.read(sessionProvider.notifier).signOut();
                  } else if (mounted) {
                    setState(() => busy = false);
                  }
                },
        ),
      ]),
    );
  }
}
