import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../widgets/common.dart';
import 'format.dart';

/// Phone permissions, always asked at the moment they are needed, with a
/// plain explanation, and a way to Settings if the member said "never".

Future<void> _explainSettings(BuildContext context, String what, String why) async {
  final open = await confirm(
    context,
    title: 'Allow $what',
    body: '$why You turned this off earlier. You can allow it in your phone’s Settings.',
    yes: 'Open Settings',
    no: 'Not now',
  );
  if (open) {
    try {
      await Geolocator.openAppSettings();
    } catch (_) {}
  }
}

/// City and state from the phone's location (coarse: the city is enough).
/// Returns null if the member declines or the location is not available.
Future<({String? city, String? state})?> currentPlace(BuildContext context) async {
  if (kIsWeb) return null;
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      if (!context.mounted) return null;
      final open = await confirm(
        context,
        title: 'Turn on location',
        body: 'Location is switched off on your phone. Turn it on to fill in your city automatically.',
        yes: 'Open Settings',
        no: 'Not now',
      );
      if (open) await Geolocator.openLocationSettings();
      return null;
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.deniedForever) {
      if (context.mounted) {
        await _explainSettings(context, 'location', 'We use your location once, only to fill in your city and state.');
      }
      return null;
    }
    if (perm == LocationPermission.denied) return null;
    final pos = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.low, timeLimit: Duration(seconds: 20)),
    );
    final marks = await Geocoding().placemarkFromCoordinates(pos.latitude, pos.longitude);
    final m = marks.isEmpty ? null : marks.first;
    if (m == null) return null;
    String? city;
    for (final x in [m.locality, m.subAdministrativeArea]) {
      if (x != null && x.trim().isNotEmpty) {
        city = x.trim();
        break;
      }
    }
    return (city: city, state: matchState(m.administrativeArea));
  } catch (_) {
    if (context.mounted) toast(context, 'Could not find your location. Please type your city.', error: true);
    return null;
  }
}

/// "National Capital Territory of Delhi" → "Delhi"; unknown → null.
String? matchState(String? raw) {
  if (raw == null || raw.trim().isEmpty) return null;
  final r = raw.toLowerCase().replaceAll('&', 'and');
  for (final s in states) {
    if (r == s.toLowerCase() || r.contains(s.toLowerCase())) return s;
  }
  if (r.contains('orissa')) return 'Odisha';
  if (r.contains('pondicherry')) return 'Puducherry';
  return null;
}

/// A photo from the camera or the gallery, already resized (smaller upload,
/// location data removed by the server). Handles permission refusals.
Future<List<XFile>> pickPhotos(BuildContext context, {required int max}) async {
  if (max <= 0) return [];
  final source = await showAppSheet<ImageSource>(
    context,
    builder: (c) => SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Take a photo'),
            onTap: () => Navigator.pop(c, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Choose from gallery'),
            onTap: () => Navigator.pop(c, ImageSource.gallery),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (source == null) return [];
  final picker = ImagePicker();
  try {
    if (source == ImageSource.camera) {
      final f = await picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 2000,
        maxHeight: 2000,
        imageQuality: 85,
        preferredCameraDevice: CameraDevice.front,
      );
      return f == null ? [] : [f];
    }
    if (max == 1) {
      final f = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2000, maxHeight: 2000, imageQuality: 85);
      return f == null ? [] : [f];
    }
    final files = await picker.pickMultiImage(maxWidth: 2000, maxHeight: 2000, imageQuality: 85, limit: max);
    return files.take(max).toList();
  } on PlatformException catch (e) {
    if (context.mounted && (e.code.contains('access_denied') || e.code.contains('permission'))) {
      await _explainSettings(
        context,
        source == ImageSource.camera ? 'camera' : 'photos',
        source == ImageSource.camera ? 'The camera is used only to take your profile photo.' : 'Photos are used only for your profile.',
      );
    } else if (context.mounted) {
      toast(context, 'Could not open the ${source == ImageSource.camera ? 'camera' : 'gallery'}.', error: true);
    }
    return [];
  } catch (_) {
    if (context.mounted) toast(context, 'Could not read that photo. Please try another.', error: true);
    return [];
  }
}

String mimeFor(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
