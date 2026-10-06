import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../app/config.dart';

import '../../app/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/photo.dart';

/// First screen for a visitor who is not signed in.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    const points = [
      (Icons.verified_user_outlined, 'Mobile-verified members only'),
      (Icons.lock_outline_rounded, 'Your number is never shown to anyone'),
      (Icons.forum_outlined, 'Chat opens only when both say yes'),
    ];
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight),
              child: ContentWidth(
                max: 520,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      GestureDetector(onLongPress: () => _serverDialog(context), child: const Logo(size: 40)),
                      SizedBox(height: box.maxHeight > 700 ? 64 : 36),
                      Text('A second chance at love, with dignity.',
                          style: t.headlineMedium?.copyWith(fontWeight: FontWeight.w600, height: 1.2)),
                      const SizedBox(height: 12),
                      Text(
                        'Meet divorced, widowed and separated Indians who are ready to marry again.',
                        style: t.bodyLarge?.copyWith(color: C.ink2, fontSize: 16.5),
                      ),
                      const SizedBox(height: 28),
                      for (final (icon, text) in points)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: Row(
                            children: [
                              Icon(icon, color: C.brand, size: 22),
                              const SizedBox(width: 12),
                              Expanded(child: Text(text, style: const TextStyle(fontSize: 15, color: C.ink))),
                            ],
                          ),
                        ),
                      SizedBox(height: box.maxHeight > 700 ? 48 : 24),
                      AppButton(label: 'Get started', expand: true, onPressed: () => context.push('/login')),
                      const SizedBox(height: 10),
                      AppButton(
                        label: 'I already have an account',
                        variant: ButtonVariant.secondary,
                        expand: true,
                        onPressed: () => context.push('/login'),
                      ),
                      const SizedBox(height: 20),
                      Center(
                        child: TextButton(
                          onPressed: () => context.push('/help'),
                          child: const Text('Help, safety and policies'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Test builds: point the app at another server (e.g. http://192.168.1.5:4000).
Future<void> _serverDialog(BuildContext context) async {
  if (!AppConfig.devTools) return;
  final c = TextEditingController(text: AppConfig.apiOrigin);
  final v = await showDialog<String>(
    context: context,
    builder: (d) => AlertDialog(
      title: const Text('Server address'),
      content: TextField(controller: c, keyboardType: TextInputType.url, decoration: const InputDecoration(hintText: 'http://192.168.1.5:4000')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Save')),
      ],
    ),
  );
  c.dispose();
  if (v == null || v.isEmpty) return;
  try {
    await (await SharedPreferences.getInstance()).setString('dev_server', v);
  } catch (_) {}
  if (context.mounted) toast(context, 'Saved. Close the app fully and open it again.');
}
