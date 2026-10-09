import 'format.dart';
import 'models.dart';

const featureGroups = [
  ('discovery', 'Finding matches'),
  ('contact', 'Contact details'),
  ('messaging', 'Interests and chat'),
  ('visibility', 'Visibility'),
  ('privacy', 'Privacy and support'),
];

/// Cheapest paid plan that unlocks a feature (or raises its limit above the current one).
PlanOffer? cheapestWith(List<PlanOffer> plans, String? key, PlanFeatures? current) {
  final paid = plans.where((p) => !p.isFree).toList()..sort((a, b) => a.priceInr.compareTo(b.priceInr));
  if (paid.isEmpty) return null;
  if (key == null || !paid.first.features.raw.containsKey(key)) {
    return paid.firstWhere((p) => p.isPopular, orElse: () => paid.first);
  }
  for (final p in paid) {
    final v = p.features.raw[key];
    if (v is bool) {
      if (v) return p;
      continue;
    }
    final n = p.features.limit(key);
    final now = current?.limit(key) ?? 0;
    if (n == -1 || (now != -1 && n > now)) return p;
  }
  return paid.last;
}

/// Short selling points for a plan card, generated from its features.
List<String> highlightsOf(PlanOffer p, Map<String, FeatureDef> defs) {
  final f = p.features;
  final out = <String>[];
  if (f.flag('startChats')) {
    out.add('Start conversations with your matches');
  } else if (f.flag('replyToPaid')) {
    out.add('Reply to paid members who write first');
  }
  if (f.limit('contactViewsPerMonth') != 0) {
    out.add('${limitText(f.limit('contactViewsPerMonth'))} contact numbers in 30 days');
  }
  out.add('${limitText(f.limit('profileViewsPerDay'))} profile views a day');
  out.add('${limitText(f.limit('interestsPerDay'))} interests a day');
  if (f.limit('photosVisible') == -1) out.add('See every photo');
  if (f.flag('seeVisitors')) out.add(defs['seeVisitors']?.label ?? 'See who viewed you');
  if (f.flag('seeShortlistedBy')) out.add(defs['seeShortlistedBy']?.label ?? 'See who shortlisted you');
  if (f.flag('profileBoost')) out.add('Profile boost in search');
  if (f.flag('incognito')) out.add(defs['incognito']?.label ?? 'Private browsing');
  return out.take(7).toList();
}
