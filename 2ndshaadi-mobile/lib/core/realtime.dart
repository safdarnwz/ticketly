import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../app/config.dart';
import 'api.dart';
import 'json.dart';
import 'models.dart';

/// Live updates over Socket.IO: new messages, read receipts, typing,
/// notifications. Screens fall back to polling while it is disconnected.
class Realtime {
  Realtime._();
  static final Realtime instance = Realtime._();

  io.Socket? _socket;
  String? _myId;
  Timer? _heartbeat;

  final connected = ValueNotifier<bool>(false);
  final _messages = StreamController<ChatMessage>.broadcast();
  final _reads = StreamController<({String by, DateTime at})>.broadcast();
  final _typing = StreamController<({String from, bool typing})>.broadcast();
  final _notifications = StreamController<AppNotification>.broadcast();
  final _connections = StreamController<void>.broadcast();

  Stream<ChatMessage> get messages => _messages.stream;
  Stream<({String by, DateTime at})> get reads => _reads.stream;
  Stream<({String from, bool typing})> get typing => _typing.stream;
  Stream<AppNotification> get notifications => _notifications.stream;
  Stream<void> get connections => _connections.stream;

  String? get myId => _myId;

  void connect(String myId) {
    if (_socket != null && _myId == myId) return;
    disconnect();
    _myId = myId;
    final socket = io.io(
      '${AppConfig.apiOrigin}/realtime',
      io.OptionBuilder()
          .setPath('/socket.io')
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(10000)
          .enableForceNew()
          // The token is read on every (re)connect, so a renewed token is always used.
          .setAuthFn((cb) => cb({'token': Api.instance.accessToken}))
          .build(),
    );
    _socket = socket;

    socket.onConnect((_) => connected.value = true);
    socket.onDisconnect((_) => connected.value = false);
    socket.onConnectError((_) => connected.value = false);

    socket.on('session:expired', (_) async {
      try {
        final s = await Api.instance.refreshSession();
        if (s != null && identical(_socket, socket)) socket.connect();
      } catch (_) {}
    });
    socket.on('message', (data) => _safe(() => _messages.add(ChatMessage.fromJson(asMap(data)))));
    socket.on('messages:read', (data) {
      _safe(() {
        final j = asMap(data);
        _reads.add((by: str(j['by']), at: dateN(j['at']) ?? DateTime.now()));
      });
    });
    socket.on('typing', (data) {
      _safe(() {
        final j = asMap(data);
        _typing.add((from: str(j['from']), typing: boolean(j['typing'])));
      });
    });
    socket.on('notification', (data) => _safe(() => _notifications.add(AppNotification.fromJson(asMap(data)))));
    socket.on('connection', (_) => _connections.add(null));

    socket.connect();
    _heartbeat = Timer.periodic(const Duration(seconds: 30), (_) {
      final visible = WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
      if (visible && socket.connected) socket.emit('heartbeat');
    });
  }

  void _safe(void Function() f) {
    try {
      f();
    } catch (e) {
      debugPrint('realtime event ignored: $e');
    }
  }

  /// Back in the foreground: make sure the socket is up (with a fresh token).
  void resume() {
    final s = _socket;
    if (s != null && !s.connected) s.connect();
  }

  void sendTyping(String to, bool typing) {
    final s = _socket;
    if (s != null && s.connected) s.emit('typing', {'to': to, 'typing': typing});
  }

  void disconnect() {
    _heartbeat?.cancel();
    _heartbeat = null;
    try {
      _socket?.dispose();
    } catch (_) {}
    _socket = null;
    _myId = null;
    connected.value = false;
  }
}
