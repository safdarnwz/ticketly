import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';
import 'json.dart';
import 'models.dart';
import 'realtime.dart';
import 'session.dart';

final _api = Api.instance;

/* ───────────── Site settings ───────────── */

class SiteController extends AsyncNotifier<SiteConfig> {
  Timer? _poll;

  @override
  Future<SiteConfig> build() async {
    final sub = _api.maintenance.listen((_) => ref.invalidateSelf());
    ref.onDispose(() {
      sub.cancel();
      _poll?.cancel();
    });
    final j = await _api.get('/site/config', auth: false);
    final site = SiteConfig.fromJson(asMap(j));
    // While in maintenance, check every 30 s so the app opens as soon as it ends.
    _poll?.cancel();
    if (site.maintenance) _poll = Timer(const Duration(seconds: 30), ref.invalidateSelf);
    return site;
  }
}

final siteProvider = AsyncNotifierProvider<SiteController, SiteConfig>(SiteController.new);

/// Site settings, or safe defaults while they load.
final siteConfigProvider = Provider<SiteConfig>((ref) => ref.watch(siteProvider).value ?? SiteConfig.empty);

/* ───────────── Badges ───────────── */

class Counts {
  final int notifications, messages, interests;
  const Counts(this.notifications, this.messages, this.interests);
  static const zero = Counts(0, 0, 0);
}

/// Unread counts for the bottom bar. Realtime events refresh them; a light
/// poll covers a dropped connection.
final countsProvider = FutureProvider<Counts>((ref) async {
  ref.watch(accountKeyProvider);
  final live = Realtime.instance.connected.value;
  final timer = Timer(Duration(seconds: live ? 60 : 20), () {
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.paused) ref.invalidateSelf();
  });
  ref.onDispose(timer.cancel);
  if (ref.read(sessionProvider).status != SessionStatus.member) return Counts.zero;
  final r = await Future.wait([
    _api.get('/notifications/unread-count'),
    _api.get('/chat/unread-count'),
    _api.get('/interests/pending-count'),
  ]);
  return Counts(integer(asMap(r[0])['count']), integer(asMap(r[1])['count']), integer(asMap(r[2])['count']));
});

/* ───────────── Account data ───────────── */

final usageProvider = FutureProvider.autoDispose<Usage>((ref) async {
  ref.watch(accountKeyProvider);
  return Usage.fromJson(asMap(await _api.get('/profiles/usage')));
});

final catalogueProvider = FutureProvider<Catalogue>((ref) async {
  return Catalogue.fromJson(asMap(await _api.get('/plans', auth: false)));
});

/// Which payment provider the server uses: razorpay | test | unavailable.
final paymentProviderProvider = FutureProvider.autoDispose<String>((ref) async {
  return str(asMap(await _api.get('/payments/plans', auth: false))['provider'], 'unavailable');
});

final myProfileProvider = FutureProvider.autoDispose<MyProfile>((ref) async {
  ref.watch(accountKeyProvider);
  return MyProfile.fromJson(asMap(await _api.get('/profiles/me')));
});

final preferencesProvider = FutureProvider.autoDispose<Json>((ref) async {
  ref.watch(accountKeyProvider);
  return asMap(await _api.get('/preferences/me'));
});

final profileProvider = FutureProvider.autoDispose.family<FullProfile, String>((ref, userId) async {
  ref.watch(accountKeyProvider);
  final p = FullProfile.fromJson(asMap(await _api.get('/profiles/$userId', quiet: true)));
  // Opening a profile uses one of today's views.
  ref.invalidate(usageProvider);
  return p;
});

final interestsProvider = FutureProvider.autoDispose.family<List<InterestItem>, String>((ref, box) async {
  ref.watch(accountKeyProvider);
  return asList(await _api.get('/interests', query: {'box': box}), InterestItem.fromJson);
});

final conversationsProvider = FutureProvider.autoDispose<List<Conversation>>((ref) async {
  ref.watch(accountKeyProvider);
  if (!Realtime.instance.connected.value) {
    final t = Timer(const Duration(seconds: 15), ref.invalidateSelf);
    ref.onDispose(t.cancel);
  }
  return asList(await _api.get('/chat/conversations'), Conversation.fromJson);
});

class LockedList {
  final bool locked;
  final int count;
  final List<MemberCard> items;
  const LockedList(this.locked, this.count, this.items);
  factory LockedList.fromJson(Json j) =>
      LockedList(boolean(j['locked']), integer(j['count']), asList(j['items'], MemberCard.fromJson));
}

final shortlistProvider = FutureProvider.autoDispose<List<MemberCard>>((ref) async {
  ref.watch(accountKeyProvider);
  return asList(await _api.get('/profiles/shortlist'), MemberCard.fromJson);
});

final shortlistedMeProvider = FutureProvider.autoDispose<LockedList>((ref) async {
  ref.watch(accountKeyProvider);
  return LockedList.fromJson(asMap(await _api.get('/profiles/shortlisted-me')));
});

final visitorsProvider = FutureProvider.autoDispose<LockedList>((ref) async {
  ref.watch(accountKeyProvider);
  return LockedList.fromJson(asMap(await _api.get('/profiles/visitors')));
});

final freshMembersProvider = FutureProvider.autoDispose<List<MemberCard>>((ref) async {
  ref.watch(accountKeyProvider);
  final p = await _api.page('/profiles/search', MemberCard.fromJson, query: {'tab': 'new', 'limit': 12}, quiet: true);
  return p.items;
});

final savedSearchesProvider = FutureProvider.autoDispose<({List<SavedSearch> items, int max})>((ref) async {
  ref.watch(accountKeyProvider);
  final j = asMap(await _api.get('/searches'));
  return (items: asList(j['items'], SavedSearch.fromJson), max: integer(j['max'], 10));
});

final memberAnnouncementsProvider = FutureProvider.autoDispose<List<Announcement>>((ref) async {
  ref.watch(accountKeyProvider);
  return asList(await _api.get('/site/announcements'), Announcement.fromJson);
});

final contentPageProvider = FutureProvider.autoDispose.family<Json, String>((ref, slug) async {
  return asMap(await _api.get('/pages/${Uri.encodeComponent(slug)}', auth: false));
});

/* ───────────── Long lists that load more as you scroll ───────────── */

class PagedState<T> {
  final List<T> items;
  final int total;
  final bool loading, loadingMore;
  final Object? error;
  final Json meta;
  const PagedState({
    this.items = const [],
    this.total = 0,
    this.loading = true,
    this.loadingMore = false,
    this.error,
    this.meta = const {},
  });
  bool get hasMore => items.length < total;
  PagedState<T> copy({List<T>? items, int? total, bool? loading, bool? loadingMore, Object? error, Json? meta}) =>
      PagedState(
        items: items ?? this.items,
        total: total ?? this.total,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        error: error,
        meta: meta ?? this.meta,
      );
}

/// 10 rows first, then 20 more each time the list nears its end.
abstract class PagedController<T> extends Notifier<PagedState<T>> {
  static const first = 10;
  static const next = 20;

  String get path;
  Map<String, dynamic> get query => const {};
  T parse(Json j);
  bool get quiet => false;

  int _generation = 0;

  @override
  PagedState<T> build() {
    ref.watch(accountKeyProvider);
    Future.microtask(_loadFirst);
    return PagedState<T>();
  }

  Future<void> _loadFirst() async {
    final gen = ++_generation;
    try {
      final p = await _api.page(path, parse, query: {...query, 'offset': 0, 'limit': first}, quiet: quiet);
      if (gen != _generation || !ref.mounted) return;
      state = PagedState(items: p.items, total: p.total, loading: false, meta: p.meta);
    } catch (e) {
      if (gen != _generation || !ref.mounted) return;
      state = state.copy(loading: false, error: e);
    }
  }

  /// Pull to refresh: keeps the current rows on screen until the new ones arrive.
  Future<void> refresh() async {
    if (state.items.isEmpty) state = state.copy(loading: true);
    await _loadFirst();
  }

  Future<void> loadMore() async {
    final s = state;
    if (s.loading || s.loadingMore || !s.hasMore || s.error != null) return;
    final gen = _generation;
    state = s.copy(loadingMore: true);
    try {
      final p = await _api.page(path, parse, query: {...query, 'offset': s.items.length, 'limit': next}, quiet: quiet);
      if (gen != _generation || !ref.mounted) return;
      // Rows can shift between pages; never show the same person twice.
      final seen = s.items.map(keyOf).toSet();
      final fresh = p.items.where((x) => seen.add(keyOf(x))).toList();
      state = state.copy(
        items: [...state.items, ...fresh],
        // A page that adds nothing new ends the list instead of looping.
        total: fresh.isEmpty ? state.items.length : p.total,
        loadingMore: false,
      );
    } catch (e) {
      if (gen != _generation || !ref.mounted) return;
      state = state.copy(loadingMore: false);
    }
  }

  Object keyOf(T item);

  void removeWhere(bool Function(T) test) {
    final before = state.items.length;
    final items = state.items.where((x) => !test(x)).toList();
    state = state.copy(items: items, total: state.total - (before - items.length));
  }

  void update(T Function(T) f) => state = state.copy(items: state.items.map(f).toList());
}

class SearchController extends PagedController<MemberCard> {
  SearchController(this.queryString);
  final String queryString;

  @override
  String get path => '/profiles/search';
  @override
  Map<String, dynamic> get query => Uri.splitQueryString(queryString);
  @override
  bool get quiet => true;
  @override
  MemberCard parse(Json j) => MemberCard.fromJson(j);
  @override
  Object keyOf(MemberCard item) => item.userId;
}

final searchProvider =
    NotifierProvider.autoDispose.family<SearchController, PagedState<MemberCard>, String>(SearchController.new);

class NotificationsController extends PagedController<AppNotification> {
  @override
  String get path => '/notifications';
  @override
  AppNotification parse(Json j) => AppNotification.fromJson(j);
  @override
  Object keyOf(AppNotification item) => item.id;

  void markRead(String id) => update((n) => n.id == id && n.readAt == null
      ? AppNotification(n.id, n.type, n.title, n.body, n.link, DateTime.now(), n.createdAt)
      : n);
  void markAllRead() => update((n) =>
      n.readAt == null ? AppNotification(n.id, n.type, n.title, n.body, n.link, DateTime.now(), n.createdAt) : n);
}

final notificationsProvider =
    NotifierProvider.autoDispose<NotificationsController, PagedState<AppNotification>>(NotificationsController.new);
