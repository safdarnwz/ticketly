import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

/// Tabs of the bottom bar: opening one switches tab instead of stacking screens.
const tabRoutes = ['/discover', '/interests', '/chats', '/alerts', '/account'];

/// Turns a link from the server (written for the website, e.g.
/// "/messages/(id)" or "/settings#devices") into the app screen for it.
String? appRouteFor(String link) {
  final uri = Uri.tryParse(link.trim());
  if (uri == null) return null;
  if (uri.hasScheme) return null;
  final parts = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  final q = uri.hasQuery ? '?${uri.query}' : '';
  if (parts.isEmpty) return '/discover';
  switch (parts.first) {
    case 'profile':
      return parts.length > 1 ? '/profile/${parts[1]}' : '/discover';
    case 'messages':
      return parts.length > 1 ? '/chat/${parts[1]}' : '/chats';
    case 'interests':
      return '/interests$q';
    case 'notifications':
      return '/alerts';
    case 'me':
      return '/edit-profile';
    case 'discover':
      return '/discover$q';
    case 'settings':
    case 'preferences':
    case 'shortlist':
    case 'visitors':
    case 'plans':
      return '/${parts.first}$q';
    case 'login':
      return '/login';
    default:
      return '/page/${parts.first}';
  }
}

/// Opens a link from a notification, announcement or page: app screens in the
/// app, web addresses in the browser.
Future<void> openLink(BuildContext context, String? link) async {
  if (link == null || link.isEmpty) return;
  final uri = Uri.tryParse(link);
  if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http' || uri.scheme == 'mailto' || uri.scheme == 'tel')) {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
    return;
  }
  final route = appRouteFor(link);
  if (route == null || !context.mounted) return;
  final path = Uri.parse(route).path;
  if (tabRoutes.contains(path)) {
    context.go(route);
  } else {
    context.push(route);
  }
}

Future<void> launchExternal(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
}
