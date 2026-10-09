import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../widgets/common.dart';
import 'api.dart';
import 'providers.dart';

/// Member actions used on several screens, with the same messages and cache
/// refreshes everywhere.
final _api = Api.instance;

void _afterInterest(WidgetRef ref, String userId) {
  ref.invalidate(profileProvider(userId));
  ref.invalidate(interestsProvider);
  ref.invalidate(countsProvider);
  ref.invalidate(conversationsProvider);
  ref.invalidate(usageProvider);
}

Future<bool> sendInterest(BuildContext context, WidgetRef ref, String userId, String firstName,
    {String? note, bool connects = false}) async {
  final ok = await runGuarded(context, () async {
    await _api.post('/interests', {'userId': userId, if (note != null && note.trim().isNotEmpty) 'message': note.trim()});
  });
  _afterInterest(ref, userId);
  if (ok && context.mounted) {
    toast(context, connects ? 'You are now connected with $firstName' : 'Interest sent to $firstName',
        actionLabel: 'View', action: () => context.go('/interests?tab=${connects ? 'connected' : 'sent'}'));
  }
  return ok;
}

Future<bool> respondInterest(BuildContext context, WidgetRef ref, String interestId, String userId, bool accept,
    {String? name}) async {
  final ok = await runGuarded(context, () async {
    await _api.patch('/interests/$interestId', {'status': accept ? 'ACCEPTED' : 'DECLINED'});
  });
  _afterInterest(ref, userId);
  if (ok && context.mounted) {
    toast(context, accept ? (name == null ? 'You are now connected' : 'You and $name are now connected') : 'Interest declined');
  }
  return ok;
}

Future<bool> withdrawInterest(BuildContext context, WidgetRef ref, String interestId, String userId) async {
  final ok = await runGuarded(context, () async => _api.delete('/interests/$interestId'));
  _afterInterest(ref, userId);
  if (ok && context.mounted) toast(context, 'Interest withdrawn');
  return ok;
}

Future<bool> setShortlisted(BuildContext context, WidgetRef ref, String userId, bool on) async {
  final ok = await runGuarded(context, () async {
    if (on) {
      await _api.post('/profiles/shortlist/$userId');
    } else {
      await _api.delete('/profiles/shortlist/$userId');
    }
  });
  ref.invalidate(shortlistProvider);
  ref.invalidate(profileProvider(userId));
  if (ok && context.mounted) toast(context, on ? 'Added to your shortlist' : 'Removed from your shortlist');
  return ok;
}

/// "Not interested": hides a member from results (undo in Settings).
Future<bool> setIgnored(BuildContext context, WidgetRef ref, String userId, bool on) async {
  final ok = await runGuarded(context, () async {
    if (on) {
      await _api.post('/profiles/$userId/ignore');
    } else {
      await _api.delete('/profiles/$userId/ignore');
    }
  });
  ref.invalidate(profileProvider(userId));
  ref.invalidate(shortlistProvider);
  if (ok && context.mounted) {
    toast(
      context,
      on ? 'Hidden from your results. Undo any time in Settings.' : 'They will appear in your results again',
      actionLabel: on ? 'Undo' : null,
      action: on ? () => setIgnored(context, ref, userId, false) : null,
    );
  }
  return ok;
}
