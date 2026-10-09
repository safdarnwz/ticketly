import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

const _categories = {
  'FAKE_OR_IMPERSONATION': 'Fake profile or someone pretending to be me',
  'INTIMATE_IMAGE': 'Intimate or private images of me',
  'HARASSMENT': 'Harassment or threats',
  'FRAUD': 'Fraud or someone asking for money',
  'PRIVACY_DATA': 'My personal data / data rights',
  'PAYMENT': 'Payment or refund',
  'ACCOUNT_ACTION': 'Action taken on my account',
  'OTHER': 'Something else',
};

/// File a complaint with the Grievance Officer, or check one (IT Rules, 2021).
class GrievanceScreen extends ConsumerStatefulWidget {
  const GrievanceScreen({super.key});
  @override
  ConsumerState<GrievanceScreen> createState() => _GrievanceScreenState();
}

class _GrievanceScreenState extends ConsumerState<GrievanceScreen> {
  late final me = ref.read(meProvider);
  late final _f = {
    'name': TextEditingController(text: me?.name ?? ''),
    'email': TextEditingController(text: me?.email ?? ''),
    'phone': TextEditingController(text: (me?.phone ?? '').replaceFirst(RegExp(r'^\+91'), '')),
    'subject': TextEditingController(),
    'description': TextEditingController(),
    'profileReference': TextEditingController(),
  };
  final _ticket = TextEditingController();
  final _contact = TextEditingController();
  String category = 'FAKE_OR_IMPERSONATION';
  bool busy = false, checking = false;
  Map<String, String> errors = {};
  Json? filed, status;

  @override
  void dispose() {
    for (final c in [..._f.values, _ticket, _contact]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      busy = true;
      errors = {};
    });
    try {
      final body = {
        for (final e in _f.entries)
          if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
        'category': category,
      };
      final r = asMap(await Api.instance.post('/grievances', body, me != null));
      if (mounted) setState(() => filed = r);
    } catch (e) {
      if (!mounted) return;
      setState(() => errors = {'form': errorText(e), if (e is ApiError) ...e.errors});
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _check() async {
    setState(() {
      checking = true;
      errors.remove('check');
    });
    try {
      final r = asMap(await Api.instance.get('/grievances/${Uri.encodeComponent(_ticket.text.trim())}',
          query: {'contact': _contact.text.trim()}, auth: false));
      if (mounted) setState(() => status = r);
    } catch (e) {
      if (mounted) setState(() => errors = {...errors, 'check': errorText(e)});
    } finally {
      if (mounted) setState(() => checking = false);
    }
  }

  Widget _field(String key, String label, {bool optional = false, int lines = 1, TextInputType? type, int max = 200}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FieldLabel(label, optional: optional),
          TextField(
            controller: _f[key],
            minLines: lines,
            maxLines: lines == 1 ? 1 : lines + 4,
            maxLength: max,
            keyboardType: type,
            decoration: InputDecoration(counterText: '', errorText: errors[key]),
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Grievance officer')),
      body: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 28),
        children: [
          ContentWidth(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SectionCard(
                title: 'File a complaint',
                child: filed != null
                    ? Notice(
                        'Your ticket number is ${str(filed!['ticket'])}. Keep it to check the status. We will respond by ${date(dateN(filed!['dueAt']))}.',
                        title: 'Complaint registered',
                        tone: PillTone.ok,
                        icon: Icons.check_circle_outline_rounded,
                        action: TextButton.icon(
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: str(filed!['ticket'])));
                            toast(context, 'Ticket number copied');
                          },
                          icon: const Icon(Icons.copy_rounded, size: 16),
                          label: const Text('Copy ticket number'),
                        ),
                      )
                    : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        _field('name', 'Your name', max: 100),
                        _field('email', 'Email', type: TextInputType.emailAddress, optional: true, max: 254),
                        _field('phone', 'Mobile number', type: TextInputType.phone, optional: true, max: 14),
                        PickerField(
                          label: 'What is it about?',
                          value: _categories[category],
                          onTap: () async {
                            final v = await pickOne<String>(context,
                                title: 'What is it about?', options: [for (final e in _categories.entries) (e.key, e.value)], current: category);
                            if (v != null) setState(() => category = v);
                          },
                        ),
                        const SizedBox(height: 12),
                        _field('subject', 'Subject', max: 150),
                        _field('description', 'What happened?', lines: 4, max: 5000),
                        _field('profileReference', 'Profile ID involved', optional: true, max: 40),
                        if (errors['form'] != null) ...[
                          Notice(errors['form']!, tone: PillTone.danger, icon: Icons.error_outline_rounded),
                          const SizedBox(height: 12),
                        ],
                        AppButton(label: 'Submit complaint', expand: true, loading: busy, onPressed: _submit),
                      ]),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: 'Check a complaint',
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const FieldLabel('Ticket number'),
                  TextField(controller: _ticket, textCapitalization: TextCapitalization.characters),
                  const SizedBox(height: 12),
                  const FieldLabel('Email or mobile you used'),
                  TextField(controller: _contact),
                  if (errors['check'] != null) FieldHint(errors['check']!, error: true),
                  const SizedBox(height: 12),
                  AppButton(label: 'Check status', variant: ButtonVariant.secondary, loading: checking, onPressed: _check),
                  if (status != null) ...[
                    const SizedBox(height: 12),
                    Notice(
                      [
                        'Status: ${str(status!['status']).toLowerCase()}',
                        'Filed ${date(dateN(status!['createdAt']))}, due ${date(dateN(status!['dueAt']))}',
                        if (strN(status!['response']) != null) 'Response: ${status!['response']}',
                      ].join('\n'),
                      title: str(status!['subject']),
                      tone: PillTone.neutral,
                    ),
                  ],
                ]),
              ),
            ]),
          ),
        ],
      ),
    );
  }
}
