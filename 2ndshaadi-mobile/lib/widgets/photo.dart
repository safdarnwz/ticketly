import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../core/api.dart';
import '../core/models.dart';

const _colours = [
  Color(0xFFF26076),
  Color(0xFFC8304D),
  Color(0xFF76ABAE),
  Color(0xFFF2842F),
  Color(0xFF6B7FD7),
  Color(0xFF3F9D6B),
  Color(0xFFB5651D),
  Color(0xFF8E5EA2),
];

/// Small stable hash, so the same name always gets the same picture.
List<int> _hash(String text) {
  final out = <int>[];
  var h = 2166136261;
  for (var round = 0; round < 24; round++) {
    for (final c in text.codeUnits) {
      h = ((h ^ c) * 16777619) & 0xFFFFFFFF;
    }
    h = ((h ^ round) * 16777619) & 0xFFFFFFFF;
    out.add(h % 256);
  }
  return out;
}

String initialsOf(String name) => name
    .split(RegExp(r'\s+'))
    .where((w) => w.isNotEmpty)
    .take(2)
    .map((w) => w.characters.first.toUpperCase())
    .join();

/// The picture shown until a member adds a photo: two colours, soft circles,
/// initials. The same name always gives the same picture.
class DefaultAvatar extends StatelessWidget {
  const DefaultAvatar({super.key, required this.name});
  final String name;
  @override
  Widget build(BuildContext context) {
    final h = _hash(name.isEmpty ? '?' : name);
    return LayoutBuilder(builder: (context, box) {
      final side = math.min(box.maxWidth.isFinite ? box.maxWidth : 100.0, box.maxHeight.isFinite ? box.maxHeight : 100.0);
      return CustomPaint(
        painter: _AvatarPainter(h),
        child: Center(
          child: Text(
            initialsOf(name).isEmpty ? '?' : initialsOf(name),
            style: TextStyle(color: Colors.white, fontSize: math.max(10, side * 0.3), fontWeight: FontWeight.w500),
          ),
        ),
      );
    });
  }
}

class _AvatarPainter extends CustomPainter {
  _AvatarPainter(this.h);
  final List<int> h;
  @override
  void paint(Canvas canvas, Size size) {
    final c1 = _colours[h[0] % _colours.length];
    final c2 = _colours[(h[1] + 3) % _colours.length];
    canvas.drawRect(Offset.zero & size, Paint()..color = c1);
    final band = size.height * (0.45 + (h[2] % 30) / 100);
    canvas.drawRect(Rect.fromLTWH(0, band, size.width, size.height), Paint()..color = c2.withValues(alpha: 0.45));
    for (var i = 0; i < 5; i++) {
      final r = (6 + h[13 + i] % 16) / 100 * size.shortestSide;
      canvas.drawCircle(
        Offset(h[3 + i] / 255 * size.width, h[8 + i] / 255 * size.height),
        r,
        Paint()..color = Colors.white.withValues(alpha: 0.1 + (h[18 + i] % 3) * 0.06),
      );
    }
  }

  @override
  bool shouldRepaint(_AvatarPainter old) => old.h != h;
}

/// Photo from the API, or the default picture when there is none or it fails.
///
/// Photo links are signed and change on every request; the cache key ignores
/// the signature, so the same photo is never downloaded twice and lists do
/// not flicker when they refresh.
class Photo extends StatelessWidget {
  const Photo({super.key, required this.url, required this.name, this.radius, this.size, this.fit = BoxFit.cover});
  final String? url;
  final String name;
  final BorderRadius? radius;
  final double? size;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final full = Api.mediaUrl(url);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    Widget child;
    if (full == null) {
      child = DefaultAvatar(name: name);
    } else {
      child = LayoutBuilder(builder: (context, box) {
        // Decode at the size shown, not the full photo: smooth scrolling, less memory.
        final w = (size ?? (box.maxWidth.isFinite ? box.maxWidth : 400)) * dpr;
        return CachedNetworkImage(
          imageUrl: full,
          cacheKey: full.split('?').first,
          fit: fit,
          memCacheWidth: w.isFinite && w > 0 ? w.round().clamp(64, 1600) : null,
          fadeInDuration: const Duration(milliseconds: 120),
          fadeOutDuration: Duration.zero,
          placeholder: (_, _) => const ColoredBox(color: C.sunk),
          errorWidget: (_, _, _) => DefaultAvatar(name: name),
        );
      });
    }
    final sized = size == null ? child : SizedBox.square(dimension: size, child: child);
    return ClipRRect(borderRadius: radius ?? BorderRadius.circular(999), child: sized);
  }
}

/// Round avatar with optional online dot.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.url, required this.name, this.size = 48, this.online = false});
  final String? url;
  final String name;
  final double size;
  final bool online;
  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Photo(url: url, name: name, size: size),
          if (online)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: size * 0.27,
                height: size * 0.27,
                decoration: BoxDecoration(
                  color: C.ok,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Premium tick: a verified seal with a white tick, after paid members' names.
class PremiumTick extends StatelessWidget {
  const PremiumTick({super.key, this.size = 16});
  final double size;
  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Premium member',
        child: CustomPaint(size: Size.square(size), painter: _SealPainter()),
      );
}

class _SealPainter extends CustomPainter {
  static const _bumps = [
    [19.6, 12.0], [18.58, 15.8], [15.8, 18.58], [12.0, 19.6], [8.2, 18.58], [5.42, 15.8], //
    [4.4, 12.0], [5.42, 8.2], [8.2, 5.42], [12.0, 4.4], [15.8, 5.42], [18.58, 8.2],
  ];
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final fill = Paint()..color = C.button;
    canvas.drawCircle(Offset(12 * s, 12 * s), 8.4 * s, fill);
    for (final b in _bumps) {
      canvas.drawCircle(Offset(b[0] * s, b[1] * s), 3.4 * s, fill);
    }
    final tick = Path()
      ..moveTo(7.9 * s, 12.4 * s)
      ..lineTo(10.6 * s, 15.1 * s)
      ..lineTo(16.1 * s, 9.5 * s);
    canvas.drawPath(
      tick,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.4 * s
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_SealPainter oldDelegate) => false;
}

/// The member's plan (Silver, Gold, Platinum) in its colour.
class PlanBadge extends StatelessWidget {
  const PlanBadge(this.badge, {super.key});
  final PlanBadgeInfo? badge;
  @override
  Widget build(BuildContext context) {
    final b = badge;
    if (b == null) return const SizedBox.shrink();
    final (colors, fg, border) = switch (b.tone) {
      'silver' => (const [Color(0xFFF7F8FA), Color(0xFFC6CAD1), Color(0xFFEEF0F3)], const Color(0xFF30343A), const Color(0xFFAEB3BB)),
      'gold' => (const [Color(0xFFFDE9A6), Color(0xFFDFAE3F), Color(0xFFF8D978)], const Color(0xFF432C00), const Color(0xFFC39228)),
      _ => (const [Color(0xFF454545), Color(0xFF0B0B0B), Color(0xFF2F2F2F)], const Color(0xFFF4F4F4), Colors.black),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.workspace_premium_rounded, size: 11, color: fg),
          const SizedBox(width: 2),
          Text(b.name.toUpperCase(),
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: fg, letterSpacing: 0.4)),
        ],
      ),
    );
  }
}

/// Two linked rings: the 2ndShaadi mark.
class LogoMark extends StatelessWidget {
  const LogoMark({super.key, this.size = 40, this.light = false});
  final double size;
  final bool light;
  @override
  Widget build(BuildContext context) => CustomPaint(size: Size.square(size), painter: _LogoPainter(light));
}

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.light);
  final bool light;
  @override
  void paint(Canvas canvas, Size size) {
    // viewBox 6 6 28 28
    final s = size.width / 28;
    Offset p(double x, double y) => Offset((x - 6) * s, (y - 6) * s);
    final a = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.8 * s
      ..color = light ? Colors.white : C.button;
    final b = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.8 * s
      ..color = light ? Colors.white.withValues(alpha: 0.7) : C.brand;
    canvas.drawCircle(p(16, 21.5), 7.2 * s, a);
    canvas.drawCircle(p(24, 21.5), 7.2 * s, b);
    final gem = Path()
      ..moveTo(p(20, 9.5).dx, p(20, 9.5).dy)
      ..lineTo(p(21.8, 11.9).dx, p(21.8, 11.9).dy)
      ..lineTo(p(20, 13.7).dx, p(20, 13.7).dy)
      ..lineTo(p(18.2, 11.9).dx, p(18.2, 11.9).dy)
      ..close();
    canvas.drawPath(gem, Paint()..color = light ? Colors.white : C.button);
  }

  @override
  bool shouldRepaint(_LogoPainter old) => old.light != light;
}

class Logo extends StatelessWidget {
  const Logo({super.key, this.size = 36});
  final double size;
  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          LogoMark(size: size),
          const SizedBox(width: 6),
          Text.rich(
            TextSpan(children: [
              const TextSpan(text: '2nd', style: TextStyle(color: C.ink)),
              TextSpan(text: 'Shaadi', style: TextStyle(color: C.brand.withValues(alpha: 1))),
            ]),
            style: TextStyle(fontSize: size * 0.56, fontWeight: FontWeight.w600, letterSpacing: -0.3),
          ),
        ],
      );
}
