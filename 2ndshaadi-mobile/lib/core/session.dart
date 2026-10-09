import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';
import 'json.dart';
import 'models.dart';

enum SessionStatus { loading, guest, member, unreachable }

class SessionState {
  final SessionStatus status;
  final Me? me;
  const SessionState(this.status, [this.me]);
}

/// Who is signed in. Never signs anyone out because of a network problem:
/// only the server saying the session ended (or "Log out") does that.
class SessionController extends Notifier<SessionState> {
  final _subs = <StreamSubscription<dynamic>>[];
  bool _booting = false;

  /// Set when the server ended the session (shown once on the login screen).
  String? endedNotice;

  /// After sign-in with an unfinished profile: open the profile editor once.
  /// "new" right after registration (shows a welcome), "finish" otherwise.
  String? afterSignIn;

  @override
  SessionState build() {
    final api = Api.instance;
    _subs.add(api.sessionRenewed.listen((s) {
      if (state.status == SessionStatus.member && s.user.isNotEmpty) {
        state = SessionState(SessionStatus.member, Me.fromJson(s.user));
      }
    }));
    _subs.add(api.sessionEnded.listen((_) {
      if (state.status == SessionStatus.member) {
        endedNotice = 'You were signed out. Please sign in again.';
        state = const SessionState(SessionStatus.guest);
      }
    }));
    ref.onDispose(() {
      for (final s in _subs) {
        s.cancel();
      }
    });
    Future.microtask(boot);
    return const SessionState(SessionStatus.loading);
  }

  /// Restores the session on launch, retrying while the network or server is busy.
  Future<void> boot() async {
    if (_booting) return;
    _booting = true;
    try {
      if (state.status != SessionStatus.loading) state = const SessionState(SessionStatus.loading);
      final token = await TokenStore.read();
      if (token == null) {
        state = const SessionState(SessionStatus.guest);
        return;
      }
      const waits = [1, 2, 4, 8];
      for (var attempt = 0; attempt <= waits.length; attempt++) {
        try {
          final s = await Api.instance.refreshSession();
          state = s == null ? const SessionState(SessionStatus.guest) : SessionState(SessionStatus.member, Me.fromJson(s.user));
          return;
        } catch (_) {
          if (attempt == waits.length) break;
          await Future<void>.delayed(Duration(seconds: waits[attempt]));
        }
      }
      state = const SessionState(SessionStatus.unreachable);
    } finally {
      _booting = false;
    }
  }

  /// After the code is verified (or registration finished).
  Future<void> signIn(Json data, {bool registered = false}) async {
    final s = await Api.instance.applySession(data);
    endedNotice = null;
    final me = Me.fromJson(s.user);
    afterSignIn = registered ? 'new' : (me.profileComplete ? null : 'finish');
    state = SessionState(SessionStatus.member, me);
  }

  Future<void> signOut() async {
    final token = await TokenStore.read();
    try {
      await Api.instance.post('/auth/logout', {'refreshToken': ?token}, false).timeout(const Duration(seconds: 6));
    } catch (_) {
      // Signing out on this phone always works, even offline.
    }
    await Api.instance.clearSession();
    state = const SessionState(SessionStatus.guest);
  }

  /// Fresh account summary (plan, privacy, completion) after a change.
  Future<void> reloadMe() async {
    try {
      final j = await Api.instance.get('/users/me');
      if (state.status == SessionStatus.member && j is Map) {
        state = SessionState(SessionStatus.member, Me.fromJson(asMap(j)));
      }
    } catch (_) {}
  }

  /// When the app comes back to the front: renew a token that expired in the background.
  Future<void> resume() async {
    if (state.status == SessionStatus.unreachable) {
      await boot();
      return;
    }
    if (state.status == SessionStatus.member && Api.instance.accessStale) {
      try {
        await Api.instance.refreshSession();
      } catch (_) {}
    }
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

/// The signed-in member, or null.
final meProvider = Provider<Me?>((ref) => ref.watch(sessionProvider).me);

/// Changes when a different member signs in; data providers watch it so
/// nothing from one account is ever shown to another.
final accountKeyProvider = Provider<String?>((ref) => ref.watch(sessionProvider.select((s) => s.me?.id)));
