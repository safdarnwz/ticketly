import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smart_auth/smart_auth.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/photo.dart';

enum _Step { identify, code, register }

/// Sign in or create an account with a one-time code (mobile number or email).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _api = Api.instance;
  final _id = TextEditingController();
  final _code = TextEditingController();
  final _codeFocus = FocusNode();
  _Step step = _Step.identify;
  bool smsOn = true, emailOn = false;
  String channel = 'sms';
  int codeLength = 6;
  int resendIn = 0;
  Timer? _timer;
  bool busy = false;
  String? error;
  String registrationToken = '';

  @override
  void initState() {
    super.initState();
    final session = ref.read(sessionProvider.notifier);
    if (session.endedNotice != null) error = session.endedNotice;
    session.endedNotice = null;
    _loadChannels();
  }

  Future<void> _loadChannels() async {
    try {
      final j = asMap(await _api.get('/auth/channels', auth: false));
      if (!mounted) return;
      setState(() {
        smsOn = boolean(j['sms'], true);
        emailOn = boolean(j['email']);
        codeLength = integer(j['codeLength'], 6) == 4 ? 4 : 6;
        if (!smsOn && emailOn) channel = 'email';
      });
    } catch (_) {
      // Defaults (mobile number, 6 digits) work; the server corrects us if not.
    }
  }

  /// Android: offers to fill the code from the SMS (Google's SMS User Consent:
  /// the member taps "Allow" once; no SMS permission is needed).
  Future<void> _listenForSms() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android || channel != 'sms') return;
    try {
      final r = await SmartAuth.instance.getSmsWithUserConsentApi(matcher: '\\d{$codeLength}');
      final code = r.data?.code;
      if (!mounted || step != _Step.code || code == null || code.length != codeLength) return;
      _code.text = code;
      _verify();
    } catch (_) {}
  }

  void _stopSms() {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      SmartAuth.instance.removeUserConsentApiListener().ignore();
    }
  }

  @override
  void dispose() {
    _stopSms();
    _timer?.cancel();
    _id.dispose();
    _code.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  String get _identifier => channel == 'sms' ? _id.text.replaceAll(RegExp(r'\D'), '') : _id.text.trim();

  Future<void> _requestCode() async {
    final id = _identifier;
    if (channel == 'sms' && id.length != 10) {
      setState(() => error = 'Please enter your 10-digit mobile number.');
      return;
    }
    if (channel == 'email' && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(id)) {
      setState(() => error = 'Please enter a valid email address.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final r = asMap(await _api.post('/auth/code', {'channel': channel, 'identifier': id}, false));
      if (!mounted) return;
      _code.clear();
      setState(() {
        step = _Step.code;
        _startTimer(integer(r['resendInSeconds'], 60));
      });
      Future.delayed(const Duration(milliseconds: 250), () {
        if (mounted) _codeFocus.requestFocus();
      });
      _stopSms();
      _listenForSms();
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void _startTimer(int seconds) {
    _timer?.cancel();
    resendIn = seconds;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => resendIn = resendIn > 0 ? resendIn - 1 : 0);
      if (resendIn == 0) t.cancel();
    });
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (code.length != codeLength || busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final r = asMap(await _api.post('/auth/verify', {'channel': channel, 'identifier': _identifier, 'code': code}, false));
      if (!mounted) return;
      if (r['status'] == 'needs_registration') {
        setState(() {
          registrationToken = str(r['registrationToken']);
          step = _Step.register;
        });
      } else {
        TextInput.finishAutofillContext();
        await ref.read(sessionProvider.notifier).signIn(r);
        // The router moves to Discover on its own.
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => error = errorText(e));
      if (e is ApiError && e.code == 'INVALID_CODE') _code.clear();
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void _back() {
    _stopSms();
    setState(() {
      error = null;
      step = step == _Step.register ? _Step.identify : _Step.identify;
    });
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: step == _Step.identify,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: step == _Step.identify
              ? (context.canPop() ? const BackButton() : null)
              : IconButton(icon: const Icon(Icons.arrow_back_rounded), onPressed: _back),
          title: const Logo(size: 30),
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
            child: ContentWidth(
              max: 480,
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                child: switch (step) {
                  _Step.identify => _identifyView(),
                  _Step.code => _codeView(),
                  _Step.register => _RegisterForm(
                      key: const ValueKey('register'),
                      registrationToken: registrationToken,
                      onExpired: () => setState(() {
                        step = _Step.identify;
                        error = 'Your sign-up took too long. Please verify your number again.';
                      }),
                    ),
                },
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _identifyView() {
    final t = Theme.of(context).textTheme;
    return AutofillGroup(
      key: const ValueKey('identify'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Welcome', style: t.headlineSmall),
          const SizedBox(height: 6),
          Text(
            channel == 'sms'
                ? 'Log in or create your free account with your mobile number.'
                : 'Log in or create your account with your email.',
            style: t.bodyLarge?.copyWith(color: C.ink2),
          ),
          const SizedBox(height: 26),
          FieldLabel(channel == 'sms' ? 'Mobile number' : 'Email address'),
          TextField(
            controller: _id,
            autofocus: true,
            keyboardType: channel == 'sms' ? TextInputType.phone : TextInputType.emailAddress,
            autofillHints: channel == 'sms' ? const [AutofillHints.telephoneNumberNational] : const [AutofillHints.email],
            textInputAction: TextInputAction.done,
            maxLength: channel == 'sms' ? 11 : 254,
            inputFormatters: channel == 'sms' ? [FilteringTextInputFormatter.allow(RegExp(r'[\d ]'))] : null,
            onSubmitted: (_) => _requestCode(),
            style: const TextStyle(fontSize: 17, letterSpacing: 0.5),
            decoration: InputDecoration(
              counterText: '',
              hintText: channel == 'sms' ? '98765 43210' : 'you@example.com',
              prefixIcon: channel == 'sms'
                  ? const Padding(
                      padding: EdgeInsets.only(left: 14, right: 8),
                      child: Text('+91', style: TextStyle(fontSize: 17, color: C.ink2, fontWeight: FontWeight.w500)),
                    )
                  : const Icon(Icons.alternate_email_rounded),
              prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
              errorText: error,
              errorMaxLines: 3,
            ),
            onChanged: (_) {
              if (error != null) setState(() => error = null);
            },
          ),
          const SizedBox(height: 20),
          AppButton(label: 'Send code', expand: true, loading: busy, onPressed: _requestCode),
          if (smsOn && emailOn)
            Center(
              child: TextButton(
                onPressed: () => setState(() {
                  channel = channel == 'sms' ? 'email' : 'sms';
                  _id.clear();
                  error = null;
                }),
                child: Text(channel == 'sms' ? 'Use email instead' : 'Use mobile number instead'),
              ),
            ),
          const SizedBox(height: 18),
          Wrap(
            children: [
              const Text('By continuing you agree to our ', style: TextStyle(fontSize: 12.5, color: C.ink3)),
              GestureDetector(
                onTap: () => context.push('/page/terms'),
                child: const Text('Terms', style: TextStyle(fontSize: 12.5, color: C.ink2, decoration: TextDecoration.underline)),
              ),
              const Text(' and ', style: TextStyle(fontSize: 12.5, color: C.ink3)),
              GestureDetector(
                onTap: () => context.push('/page/privacy'),
                child: const Text('Privacy Policy',
                    style: TextStyle(fontSize: 12.5, color: C.ink2, decoration: TextDecoration.underline)),
              ),
              const Text('. You must be 18 or older (21 for men).', style: TextStyle(fontSize: 12.5, color: C.ink3)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _codeView() {
    final t = Theme.of(context).textTheme;
    final shown = channel == 'sms' ? (phone('+91$_identifier') ?? _identifier) : _identifier;
    return Column(
      key: const ValueKey('code'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(channel == 'sms' ? 'Verify your number' : 'Check your email', style: t.headlineSmall),
        const SizedBox(height: 6),
        Text.rich(
          TextSpan(children: [
            const TextSpan(text: 'Code sent to '),
            TextSpan(text: shown, style: const TextStyle(fontWeight: FontWeight.w600, color: C.ink)),
            const TextSpan(text: '. It expires in 10 minutes.'),
          ]),
          style: t.bodyLarge?.copyWith(color: C.ink2),
        ),
        const SizedBox(height: 26),
        TextField(
          controller: _code,
          focusNode: _codeFocus,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          textAlign: TextAlign.center,
          maxLength: codeLength,
          enabled: !busy,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: const TextStyle(fontSize: 26, letterSpacing: 14, fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            counterText: '',
            hintText: '•' * codeLength,
            hintStyle: const TextStyle(color: C.lineStrong, letterSpacing: 14),
            errorText: error,
            errorMaxLines: 3,
          ),
          onChanged: (v) {
            if (error != null) setState(() => error = null);
            // Continue as soon as every digit is in (typed, pasted or autofilled).
            if (v.length == codeLength) _verify();
          },
        ),
        const SizedBox(height: 20),
        AppButton(label: 'Continue', expand: true, loading: busy, onPressed: _verify),
        const SizedBox(height: 16),
        Row(
          children: [
            const Text('Did not get it? ', style: TextStyle(color: C.ink2)),
            if (resendIn > 0)
              Text('Send again in ${resendIn}s', style: const TextStyle(color: C.ink3))
            else
              TextButton(onPressed: busy ? null : _requestCode, child: const Text('Send a new code')),
          ],
        ),
        TextButton.icon(
          onPressed: _back,
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: Text(channel == 'sms' ? 'Change number' : 'Change email'),
        ),
      ],
    );
  }
}

class _RegisterForm extends ConsumerStatefulWidget {
  const _RegisterForm({super.key, required this.registrationToken, required this.onExpired});
  final String registrationToken;
  final VoidCallback onExpired;
  @override
  ConsumerState<_RegisterForm> createState() => _RegisterFormState();
}

class _RegisterFormState extends ConsumerState<_RegisterForm> {
  final _name = TextEditingController();
  String? gender, maritalStatus;
  DateTime? dob;
  bool tried = false, busy = false;
  String? error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _pickDob() async {
    final rules = ref.read(siteConfigProvider).section('profileRules');
    final minAge = gender == 'MALE' ? integer(rules['minAgeMen'], 21) : integer(rules['minAgeWomen'], 18);
    final maxAge = integer(rules['maxAge'], 80);
    final now = DateTime.now();
    final last = DateTime(now.year - minAge, now.month, now.day);
    final first = DateTime(now.year - maxAge, now.month, now.day);
    final initial = dob != null && !dob!.isBefore(first) && !dob!.isAfter(last) ? dob! : DateTime(now.year - 35, 1, 1);
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(last) ? last : initial,
      firstDate: first,
      lastDate: last,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
      helpText: 'Date of birth',
    );
    if (picked != null && mounted) setState(() => dob = picked);
  }

  Future<void> _submit() async {
    setState(() => tried = true);
    final name = _name.text.trim();
    if (name.length < 2 || gender == null || maritalStatus == null || dob == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final d = dob!;
      final r = asMap(await Api.instance.post(
        '/auth/register',
        {
          'registrationToken': widget.registrationToken,
          'fullName': name,
          'gender': gender,
          'maritalStatus': maritalStatus,
          'dateOfBirth':
              '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
        },
        false,
      ));
      await ref.read(sessionProvider.notifier).signIn(r, registered: true);
    } catch (e) {
      if (!mounted) return;
      if (e is ApiError && e.status == 401) {
        widget.onExpired();
      } else {
        setState(() => error = errorText(e));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final nameError = tried && _name.text.trim().length < 2 ? 'Please enter your full name.' : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Tell us about you', style: t.headlineSmall),
        const SizedBox(height: 6),
        Text('Only your first name and initial are shown to other members.', style: t.bodyLarge?.copyWith(color: C.ink2)),
        const SizedBox(height: 24),
        const FieldLabel('Full name'),
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          autofillHints: const [AutofillHints.name],
          maxLength: 100,
          decoration: InputDecoration(counterText: '', errorText: nameError),
          onChanged: (_) => tried ? setState(() {}) : null,
        ),
        const SizedBox(height: 18),
        const FieldLabel('I am a'),
        ChoiceChips<String>(
          options: const [('FEMALE', 'Woman'), ('MALE', 'Man')],
          selected: {?gender},
          onChanged: (v) => setState(() => gender = v.firstOrNull),
        ),
        if (tried && gender == null) const FieldHint('Please choose one.', error: true),
        const FieldHint('This cannot be changed later.'),
        const SizedBox(height: 18),
        const FieldLabel('Marital status'),
        ChoiceChips<String>(
          options: [for (final e in marital.entries) (e.key, e.value)],
          selected: {?maritalStatus},
          onChanged: (v) => setState(() => maritalStatus = v.firstOrNull),
        ),
        if (tried && maritalStatus == null) const FieldHint('Please choose one.', error: true),
        const SizedBox(height: 18),
        PickerField(
          label: 'Date of birth',
          value: dob == null ? null : date(dob),
          placeholder: 'Choose your date of birth',
          onTap: _pickDob,
        ),
        if (tried && dob == null) const FieldHint('Please enter your date of birth.', error: true),
        if (error != null) ...[
          const SizedBox(height: 16),
          Notice(error!, tone: PillTone.danger, icon: Icons.error_outline_rounded),
        ],
        const SizedBox(height: 24),
        AppButton(label: 'Create my account', expand: true, loading: busy, onPressed: _submit),
      ],
    );
  }
}
