import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/realtime.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/photo.dart';
import '../../widgets/report_block.dart';

class _Pending {
  final String tempId, body;
  bool failed;
  _Pending(this.tempId, this.body) : failed = false;
}

const _stopCodes = {
  'MESSAGE_BLOCKED',
  'UPGRADE_REQUIRED',
  'DAILY_LIMIT',
  'NOT_CONNECTED',
  'FEATURE_OFF',
  'CHAT_BANNED',
  'CHAT_NOT_ACCEPTED',
};

/// One conversation. New messages arrive live; if the live connection drops,
/// it checks every 8 seconds instead. Sending is optimistic with retry.
class ThreadScreen extends ConsumerStatefulWidget {
  const ThreadScreen({super.key, required this.peerId});
  final String peerId;
  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> with WidgetsBindingObserver {
  final _api = Api.instance;
  final _draft = TextEditingController();
  final _scroll = ScrollController();
  final _subs = <StreamSubscription<dynamic>>[];
  Timer? _poll, _typingOff;

  Json? peer;
  Object? error;
  bool loading = true, hasMore = false, loadingOlder = false, typing = false;
  List<ChatMessage> messages = [];
  final List<_Pending> pending = [];
  bool canWrite = true;
  String? blockedReason, blockedMessage;
  int? remainingInChat;
  DateTime _lastTypingSent = DateTime.fromMillisecondsSinceEpoch(0);

  String get myId => ref.read(meProvider)?.id ?? '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scroll.addListener(() {
      // The list is reversed: the top (older messages) is the far end.
      if (_scroll.hasClients && _scroll.position.extentAfter < 300) _loadOlder();
    });
    final rt = Realtime.instance;
    _subs.add(rt.messages.listen((m) {
      final mine = m.senderId == myId;
      final other = mine ? m.receiverId : m.senderId;
      if (other != widget.peerId || !mounted) return;
      if (messages.any((x) => x.id == m.id)) return;
      setState(() {
        messages = [...messages, m];
        if (!mine) typing = false;
      });
      if (!mine) _markRead();
    }));
    _subs.add(rt.reads.listen((r) {
      if (r.by != widget.peerId || !mounted) return;
      setState(() => messages = [for (final m in messages) m.senderId == myId && m.readAt == null ? m.read(r.at) : m]);
    }));
    _subs.add(rt.typing.listen((t) {
      if (t.from != widget.peerId || !mounted) return;
      setState(() => typing = t.typing);
      _typingOff?.cancel();
      if (t.typing) _typingOff = Timer(const Duration(seconds: 6), () => mounted ? setState(() => typing = false) : null);
    }));
    rt.connected.addListener(_onConnection);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    Realtime.instance.connected.removeListener(_onConnection);
    Realtime.instance.sendTyping(widget.peerId, false);
    for (final s in _subs) {
      s.cancel();
    }
    _poll?.cancel();
    _typingOff?.cancel();
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _onConnection() {
    _poll?.cancel();
    if (!Realtime.instance.connected.value) {
      _poll = Timer.periodic(const Duration(seconds: 8), (_) => _refresh());
    } else {
      _refresh();
    }
  }

  void _applyHistory(Json h, {bool replace = true}) {
    final list = asList(h['messages'], ChatMessage.fromJson);
    canWrite = h['canWrite'] != false;
    if (!canWrite) blockedReason = strN(h['writeBlockedReason']) ?? 'BLOCKED';
    blockedMessage = strN(h['writeBlockedMessage']);
    remainingInChat = intN(h['remainingInChat']);
    if (replace) {
      // Keep older pages already loaded; merge the newest page in.
      final known = {for (final m in messages) m.id: m};
      for (final m in list) {
        known[m.id] = m;
      }
      final merged = known.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));
      messages = merged;
      if (messages.length == list.length) hasMore = boolean(h['hasMore']);
    }
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final p = asMap(await _api.get('/chat/${widget.peerId}'));
      final h = asMap(await _api.get('/chat/${widget.peerId}/messages', query: {'limit': 40}));
      if (!mounted) return;
      setState(() {
        peer = p;
        messages = [];
        _applyHistory(h);
        hasMore = boolean(h['hasMore']);
        loading = false;
      });
      _markRead();
      _onConnection();
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e;
          loading = false;
        });
      }
    }
  }

  Future<void> _refresh() async {
    if (loading || peer == null) return;
    try {
      final h = asMap(await _api.get('/chat/${widget.peerId}/messages', query: {'limit': 40}));
      if (!mounted) return;
      setState(() => _applyHistory(h));
      _markRead();
    } catch (_) {}
  }

  Future<void> _loadOlder() async {
    if (loadingOlder || !hasMore || messages.isEmpty) return;
    setState(() => loadingOlder = true);
    try {
      final h = asMap(await _api.get('/chat/${widget.peerId}/messages', query: {'limit': 40, 'before': messages.first.id}));
      final older = asList(h['messages'], ChatMessage.fromJson);
      if (!mounted) return;
      final ids = messages.map((m) => m.id).toSet();
      setState(() {
        messages = [...older.where((m) => !ids.contains(m.id)), ...messages];
        hasMore = boolean(h['hasMore']) && older.isNotEmpty;
      });
    } catch (_) {
      // Try again on the next scroll.
    } finally {
      if (mounted) setState(() => loadingOlder = false);
    }
  }

  void _markRead() {
    final last = messages.lastWhere((m) => m.senderId == widget.peerId, orElse: () => ChatMessage('', '', '', '', DateTime(0), DateTime(0)));
    if (last.id.isEmpty || last.readAt != null) return;
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) return;
    _api.post('/chat/${widget.peerId}/read').then((_) {
      ref.invalidate(countsProvider);
      ref.invalidate(conversationsProvider);
    }, onError: (_) {});
  }

  void _onTyping(String v) {
    final now = DateTime.now();
    if (v.isNotEmpty && now.difference(_lastTypingSent) > const Duration(seconds: 3)) {
      Realtime.instance.sendTyping(widget.peerId, true);
      _lastTypingSent = now;
    }
  }

  Future<void> _send([_Pending? retry]) async {
    final body = retry?.body ?? _draft.text.trim();
    if (body.isEmpty) return;
    final item = retry ?? _Pending(const Uuid().v4(), body);
    setState(() {
      if (retry == null) {
        pending.add(item);
        _draft.clear();
      } else {
        retry.failed = false;
      }
      blockedReason = null;
    });
    Realtime.instance.sendTyping(widget.peerId, false);
    HapticFeedback.lightImpact();
    try {
      final m = ChatMessage.fromJson(asMap(await _api.post('/chat/${widget.peerId}/messages', {'body': body}, true, true)));
      if (!mounted) return;
      setState(() {
        pending.remove(item);
        if (!messages.any((x) => x.id == m.id)) messages = [...messages, m];
        if (remainingInChat != null && remainingInChat! > 0) remainingInChat = remainingInChat! - 1;
      });
      ref.invalidate(conversationsProvider);
    } catch (e) {
      if (!mounted) return;
      if (e is ApiError && _stopCodes.contains(e.code)) {
        setState(() {
          pending.remove(item);
          _draft.text = e.code == 'CHAT_BANNED' ? '' : body;
          blockedReason = e.code;
          blockedMessage = e.message;
        });
        if (e.code == 'CHAT_BANNED') ref.read(sessionProvider.notifier).reloadMe();
        if (const {'MESSAGE_BLOCKED', 'FEATURE_OFF', 'CHAT_BANNED'}.contains(e.code)) toast(context, e.message, error: true);
        _refresh();
      } else {
        setState(() => item.failed = true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final name = str(peer?['name'], '');
    final photo = strN(peer?['photo']);
    final presence = asMap(peer?['presence']);
    final online = boolean(presence['online']);
    final lastSeen = dateN(presence['lastSeenAt']);
    final first = name.split(' ').first;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: peer == null
            ? null
            : InkWell(
                onTap: () => context.push('/profile/${widget.peerId}'),
                child: Row(children: [
                  Avatar(url: photo, name: name, size: 40, online: online),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16)),
                      Text(
                        typing
                            ? 'typing…'
                            : online
                                ? 'Online'
                                : lastSeen != null
                                    ? 'Active ${ago(lastSeen)}'
                                    : 'Tap to view profile',
                        style: TextStyle(fontSize: 12, color: typing || online ? C.brand : C.ink3, fontWeight: FontWeight.w500),
                      ),
                    ]),
                  ),
                ]),
              ),
        actions: [
          if (peer != null)
            PopupMenuButton<String>(
              onSelected: (v) async {
                if (v == 'profile') {
                  context.push('/profile/${widget.peerId}');
                } else if (v == 'report') {
                  final blocked = await showReportSheet(context, userId: widget.peerId, name: name);
                  if (blocked == true && context.mounted) context.pop();
                } else if (v == 'block') {
                  if (await blockMember(context, ref, userId: widget.peerId, name: name) && context.mounted) context.pop();
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'profile', child: Text('View profile')),
                PopupMenuItem(value: 'report', child: Text('Report')),
                PopupMenuItem(value: 'block', child: Text('Block', style: TextStyle(color: C.danger))),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(child: _body(first, photo, name, me)),
          _composer(first, me),
        ],
      ),
    );
  }

  Widget _body(String first, String? photo, String name, Me? me) {
    if (loading && peer == null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final (w, mine) in [(0.6, false), (0.4, true), (0.7, false), (0.35, true), (0.55, false)])
            Align(
              alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: w,
                child: const Padding(padding: EdgeInsets.only(bottom: 10), child: Skeleton(height: 42, radius: 16)),
              ),
            ),
        ],
      );
    }
    if (error != null) {
      final e = error;
      if (e is ApiError && e.code == 'NOT_CONNECTED') {
        return EmptyState(
          icon: Icons.chat_bubble_outline_rounded,
          title: 'This conversation is not available',
          body: 'You can message someone only while you are connected. They may have closed their account.',
          action: AppButton(label: 'Back', variant: ButtonVariant.secondary, onPressed: () => context.pop()),
        );
      }
      return ErrorState(error: e, onRetry: _load);
    }
    if (messages.isEmpty && pending.isEmpty) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(children: [
          Avatar(url: photo, name: name, size: 84),
          const SizedBox(height: 14),
          Text('You and $first are connected', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 6),
          const Text(
            'Start with something from their profile. Keep it friendly — and never share money, codes or bank details.',
            textAlign: TextAlign.center,
            style: TextStyle(color: C.ink2),
          ),
        ]),
      );
    }

    // Newest at the bottom: the list is reversed so it starts there and stays there.
    final items = <Widget>[];
    final lastMine = messages.lastWhere((m) => m.senderId == myId, orElse: () => ChatMessage('', '', '', '', DateTime(0), null));
    if (typing) {
      items.add(Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text('$first is typing…', style: const TextStyle(color: C.ink3, fontStyle: FontStyle.italic, fontSize: 13)),
      ));
    }
    for (final p in pending.reversed) {
      items.add(_PendingBubble(p: p, onRetry: () => _send(p)));
    }
    for (var i = messages.length - 1; i >= 0; i--) {
      final m = messages[i];
      final mine = m.senderId == myId;
      final prev = i > 0 ? messages[i - 1] : null;
      final newDay = prev == null || !_sameDay(prev.createdAt, m.createdAt);
      final grouped = prev != null && prev.senderId == m.senderId && !newDay;
      if (mine && m.id == lastMine.id && m.readAt != null) {
        items.add(const Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text('Seen', style: TextStyle(fontSize: 11, color: C.brand, fontWeight: FontWeight.w600)),
          ),
        ));
      }
      items.add(_Bubble(m: m, mine: mine, grouped: grouped));
      if (newDay) items.add(_DayChip(m.createdAt));
    }
    if (hasMore) {
      items.add(const Padding(
        padding: EdgeInsets.all(12),
        child: Center(child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))),
      ));
    }
    return ListView.builder(
      controller: _scroll,
      reverse: true,
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      itemCount: items.length,
      itemBuilder: (_, i) => ContentWidth(max: 760, child: items[i]),
    );
  }

  static bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  Widget _composer(String first, Me? me) {
    final reason = blockedReason;
    final banned = reason == 'CHAT_BANNED' || (me?.chatBanned ?? false);
    final maxLen = ref.watch(siteConfigProvider).chatMaxLength;
    Widget? notice;
    if (banned) {
      notice = Notice(
        '${sentence(me?.chatBanReason).isEmpty ? 'Chat is switched off on your account.' : sentence(me?.chatBanReason)} Sharing numbers, emails or app IDs, or asking for money or bank details, is not allowed. Our team reviews every case within 24 hours.',
        tone: PillTone.danger,
        icon: Icons.block_rounded,
      );
    } else if (reason != null) {
      notice = Notice(
        blockedMessage ?? 'You cannot send messages here right now.',
        icon: Icons.lock_rounded,
        action: reason == 'CHAT_NOT_ACCEPTED'
            ? null
            : GestureDetector(
                onTap: () => context.push('/plans'),
                child: const Text('See plans', style: TextStyle(color: C.brand, fontWeight: FontWeight.w700)),
              ),
      );
    } else if (remainingInChat != null) {
      notice = Text('${plural(remainingInChat!, 'message')} left to ${first.isEmpty ? 'this member' : first} on your plan.',
          style: const TextStyle(fontSize: 12, color: C.ink3, fontWeight: FontWeight.w500));
    }
    final disabled = banned || !canWrite || peer == null;
    return Material(
      color: C.surface,
      child: SafeArea(
        top: false,
        child: Container(
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          child: ContentWidth(
            max: 760,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (notice != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: notice),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _draft,
                        enabled: !disabled,
                        minLines: 1,
                        maxLines: 5,
                        maxLength: maxLen,
                        textCapitalization: TextCapitalization.sentences,
                        keyboardType: TextInputType.multiline,
                        onChanged: _onTyping,
                        decoration: InputDecoration(
                          hintText: 'Write a message',
                          counterText: '',
                          fillColor: C.soft,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: C.line)),
                          enabledBorder:
                              OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: C.line)),
                          focusedBorder:
                              OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: C.brand)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ValueListenableBuilder<TextEditingValue>(
                      valueListenable: _draft,
                      builder: (_, v, _) => IconButton.filled(
                        tooltip: 'Send',
                        onPressed: disabled || v.text.trim().isEmpty ? null : () => _send(),
                        style: IconButton.styleFrom(
                          backgroundColor: C.button,
                          disabledBackgroundColor: C.button.withValues(alpha: 0.4),
                          fixedSize: const Size(48, 48),
                        ),
                        icon: const Icon(Icons.send_rounded, color: Colors.white),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip(this.d);
  final DateTime d;
  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 14),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(999)),
          child: Text(dayLabel(d), style: const TextStyle(fontSize: 11.5, color: C.ink3, fontWeight: FontWeight.w600)),
        ),
      );
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.m, required this.mine, required this.grouped});
  final ChatMessage m;
  final bool mine, grouped;
  @override
  Widget build(BuildContext context) {
    final maxW = MediaQuery.sizeOf(context).width * 0.78;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () {
          Clipboard.setData(ClipboardData(text: m.body));
          HapticFeedback.selectionClick();
          toast(context, 'Message copied');
        },
        child: Container(
          constraints: BoxConstraints(maxWidth: maxW > 560 ? 560 : maxW),
          margin: EdgeInsets.only(top: grouped ? 3 : 10),
          padding: const EdgeInsets.fromLTRB(14, 9, 12, 7),
          decoration: BoxDecoration(
            color: mine ? C.button : C.surface,
            border: mine ? null : Border.all(color: C.line),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(mine ? 16 : 5),
              bottomRight: Radius.circular(mine ? 5 : 16),
            ),
          ),
          child: Wrap(
            alignment: WrapAlignment.end,
            crossAxisAlignment: WrapCrossAlignment.end,
            spacing: 8,
            children: [
              Text(m.body, style: TextStyle(fontSize: 15, height: 1.35, color: mine ? Colors.white : C.ink)),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(time(m.createdAt),
                    style: TextStyle(fontSize: 10.5, color: mine ? Colors.white.withValues(alpha: 0.8) : C.ink3)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PendingBubble extends StatelessWidget {
  const _PendingBubble({required this.p, required this.onRetry});
  final _Pending p;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerRight,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Container(
              constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(color: C.button.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(16)),
              child: Text(p.body, style: const TextStyle(fontSize: 15, color: Colors.white)),
            ),
            p.failed
                ? TextButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.error_outline_rounded, size: 16, color: C.danger),
                    label: const Text('Not sent · Tap to retry', style: TextStyle(color: C.danger, fontSize: 12)),
                  )
                : const Padding(
                    padding: EdgeInsets.only(top: 3),
                    child: Text('Sending…', style: TextStyle(fontSize: 11, color: C.ink3)),
                  ),
          ],
        ),
      );
}
