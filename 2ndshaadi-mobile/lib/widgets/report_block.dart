import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/providers.dart';
import 'common.dart';

/// Report a member. Resolves to true when they were also blocked.
Future<bool?> showReportSheet(BuildContext context, {required String userId, required String name}) =>
    showAppSheet<bool>(context, builder: (c) => _Report(userId: userId, name: name));

class _Report extends ConsumerStatefulWidget {
  const _Report({required this.userId, required this.name});
  final String userId, name;
  @override
  ConsumerState<_Report> createState() => _ReportState();
}

class _ReportState extends ConsumerState<_Report> {
  String? reason;
  bool alsoBlock = true, busy = false;
  final _details = TextEditingController();

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.paddingOf(context).bottom),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Report ${widget.name}', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text('Reports are confidential. ${widget.name} will not know you reported them.',
              style: const TextStyle(color: C.ink2)),
          const SizedBox(height: 12),
          RadioGroup<String>(
            groupValue: reason,
            onChanged: (v) => setState(() => reason = v),
            child: Column(
              children: [
                for (final e in reportReasons.entries)
                  RadioListTile<String>(
                    value: e.key,
                    title: Text(e.value, style: const TextStyle(fontSize: 14.5)),
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    activeColor: C.button,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          const FieldLabel('Anything else we should know?', optional: true),
          TextField(controller: _details, maxLines: 3, maxLength: 1000),
          ToggleRow(
            label: 'Also block ${widget.name}',
            description: 'You will no longer see each other anywhere on 2ndShaadi.',
            value: alsoBlock,
            onChanged: (v) => setState(() => alsoBlock = v),
          ),
          const SizedBox(height: 12),
          AppButton(
            label: 'Send report',
            expand: true,
            loading: busy,
            onPressed: reason == null
                ? null
                : () async {
                    setState(() => busy = true);
                    final ok = await runGuarded(context, () async {
                      await Api.instance.post('/reports', {
                        'userId': widget.userId,
                        'reason': reason,
                        if (_details.text.trim().isNotEmpty) 'details': _details.text.trim(),
                        'alsoBlock': alsoBlock,
                      });
                    });
                    if (!context.mounted) return;
                    setState(() => busy = false);
                    if (ok) {
                      _refreshAfterBlock(ref, widget.userId);
                      toast(context, 'Thank you. Our team will review this report.');
                      Navigator.pop(context, alsoBlock);
                    }
                  },
          ),
        ],
      ),
    );
  }
}

void _refreshAfterBlock(WidgetRef ref, String userId) {
  ref.invalidate(profileProvider(userId));
  ref.invalidate(conversationsProvider);
  ref.invalidate(interestsProvider);
  ref.invalidate(shortlistProvider);
  ref.invalidate(countsProvider);
  ref.invalidate(searchProvider);
}

/// Block a member after confirming. Resolves to true when blocked.
Future<bool> blockMember(BuildContext context, WidgetRef ref, {required String userId, required String name}) async {
  final yes = await confirm(
    context,
    title: 'Block $name?',
    body:
        'You will not see each other in search, and any conversation will be closed. $name will not be told. You can unblock later from Settings.',
    yes: 'Block',
    danger: true,
  );
  if (!yes || !context.mounted) return false;
  final ok = await runGuarded(context, () async => Api.instance.post('/blocks', {'userId': userId}));
  if (ok) {
    _refreshAfterBlock(ref, userId);
    if (context.mounted) toast(context, '$name has been blocked');
  }
  return ok;
}
