/// Defensive JSON readers: a missing or unexpected value never throws, it
/// falls back to a safe default, so one odd field cannot crash a screen.
typedef Json = Map<String, dynamic>;

Json asMap(Object? v) {
  if (v is Map<String, dynamic>) return v;
  if (v is Map) return v.map((k, val) => MapEntry('$k', val));
  return <String, dynamic>{};
}

List<T> asList<T>(Object? v, T Function(Json) f) {
  if (v is! List) return <T>[];
  final out = <T>[];
  for (final e in v) {
    if (e is Map) {
      try {
        out.add(f(asMap(e)));
      } catch (_) {
        // Skip a broken row instead of failing the whole list.
      }
    }
  }
  return out;
}

String str(Object? v, [String fallback = '']) {
  if (v is String) return v;
  if (v == null) return fallback;
  return '$v';
}

String? strN(Object? v) {
  if (v == null) return null;
  final s = v is String ? v : '$v';
  return s.isEmpty ? null : s;
}

int integer(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.round() ?? fallback;
  return fallback;
}

int? intN(Object? v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.round();
  return null;
}

double? numN(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

bool boolean(Object? v, [bool fallback = false]) {
  if (v is bool) return v;
  if (v is String) return v == 'true';
  return fallback;
}

bool? boolN(Object? v) => v is bool ? v : null;

DateTime? dateN(Object? v) {
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v)?.toLocal();
  if (v is int) return DateTime.fromMillisecondsSinceEpoch(v);
  return null;
}

List<String> strList(Object? v) => v is List ? v.where((e) => e != null).map((e) => '$e').toList() : <String>[];
