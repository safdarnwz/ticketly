import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/models.dart';
import '../../core/permissions.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/photo.dart';

const _editable = [
  'fullName', 'maritalStatus', 'dateOfBirth', 'heightCm', 'religion', 'community', 'motherTongue', 'education', //
  'profession', 'incomeLpa', 'city', 'state', 'country', 'aboutMe', 'lookingFor', 'diet', 'smoking', 'drinking',
  'childrenCount', 'childrenLiveWithMe', 'wantsMoreChildren', 'isHidden',
];
const _textKeys = ['fullName', 'community', 'education', 'profession', 'city', 'aboutMe', 'lookingFor', 'incomeLpa'];

class EditProfileScreen extends ConsumerWidget {
  const EditProfileScreen({super.key, this.welcome = false});
  final bool welcome;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(myProfileProvider);
    return data.when(
      skipLoadingOnRefresh: true,
      loading: () => Scaffold(appBar: AppBar(title: const Text('My profile')), body: const ListSkeleton(rows: 5, height: 120)),
      error: (e, _) => Scaffold(
        appBar: AppBar(title: const Text('My profile')),
        body: ErrorState(error: e, onRetry: () => ref.invalidate(myProfileProvider)),
      ),
      data: (p) => _Editor(key: ValueKey(p.id), profile: p, welcome: welcome),
    );
  }
}

class _Editor extends ConsumerStatefulWidget {
  const _Editor({super.key, required this.profile, required this.welcome});
  final MyProfile profile;
  final bool welcome;
  @override
  ConsumerState<_Editor> createState() => _EditorState();
}

class _EditorState extends ConsumerState<_Editor> {
  late Json saved = _pick(widget.profile.raw);
  late Json form = {...saved};
  late final Map<String, TextEditingController> _c = {
    for (final k in _textKeys) k: TextEditingController(text: form[k] == null ? '' : '${form[k]}'),
  };
  bool tried = false, saving = false, locating = false;

  static Json _pick(Json raw) => {for (final k in _editable) k: raw[k]};

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Json get _current {
    final out = {...form};
    for (final k in _textKeys) {
      final v = _c[k]!.text.trim();
      if (k == 'incomeLpa') {
        out[k] = v.isEmpty ? null : (int.tryParse(v) ?? 0).clamp(0, 1000);
      } else if (k == 'fullName') {
        out[k] = v;
      } else {
        out[k] = v.isEmpty ? null : v;
      }
    }
    return out;
  }

  bool get dirty => jsonEncode(_current) != jsonEncode(saved);

  void set(String k, Object? v) => setState(() => form[k] = v);

  /// Name, date of birth and religion can be changed once after they are first filled in.
  ({bool locked, String? hint}) _once(String key, DateTime? stamp) {
    final has = saved[key] != null && '${saved[key]}'.isNotEmpty;
    if (!has) return (locked: false, hint: null);
    return stamp != null
        ? (locked: true, hint: 'Already changed once. It cannot be changed again.')
        : (locked: false, hint: 'You can change this only once.');
  }

  Future<void> _save() async {
    setState(() => tried = true);
    final cur = _current;
    final minAbout = ref.read(siteConfigProvider).aboutMinLength;
    final about = str(cur['aboutMe']).trim();
    if (str(cur['fullName']).trim().length < 2) return toast(context, 'Please enter your full name.', error: true);
    if (about.isNotEmpty && about.length < minAbout) {
      return toast(context, 'Please write at least $minAbout characters about you (${about.length} so far).', error: true);
    }
    final p = widget.profile;
    final once = [
      ('fullName', p.nameChangedAt, 'name'),
      ('dateOfBirth', p.dobChangedAt, 'date of birth'),
      ('religion', p.religionChangedAt, 'religion'),
    ].where((x) => saved[x.$1] != null && x.$2 == null && cur[x.$1] != saved[x.$1]).map((x) => x.$3).toList();
    if (once.isNotEmpty &&
        !await confirm(context,
            title: 'Change your ${once.join(', ')}?',
            body: 'You can change this only once. After this it cannot be changed again.',
            yes: 'Save')) {
      return;
    }
    final changed = {for (final k in _editable) if (jsonEncode(cur[k]) != jsonEncode(saved[k])) k: cur[k]};
    if (changed.isEmpty) return;
    setState(() => saving = true);
    final wasComplete = ref.read(meProvider)?.profileComplete ?? false;
    try {
      final r = MyProfile.fromJson(asMap(await Api.instance.patch('/profiles/me', changed)));
      ref.invalidate(myProfileProvider);
      await ref.read(sessionProvider.notifier).reloadMe();
      ref.invalidate(searchProvider);
      if (!mounted) return;
      setState(() {
        saved = _pick(r.raw);
        form = {...saved};
        for (final k in _textKeys) {
          _c[k]!.text = form[k] == null ? '' : '${form[k]}';
        }
      });
      toast(context, !wasComplete && r.isComplete ? 'Your profile is complete. Welcome to Discover!' : 'Profile saved');
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _useLocation() async {
    setState(() => locating = true);
    final place = await currentPlace(context);
    if (!mounted) return;
    setState(() {
      locating = false;
      if (place?.city != null) _c['city']!.text = place!.city!;
      if (place?.state != null) form['state'] = place!.state;
    });
    if (place != null && place.city == null && place.state == null) {
      toast(context, 'Could not tell your city from your location. Please type it.');
    }
  }

  Future<void> _pickDob(bool locked) async {
    if (locked) return;
    final now = DateTime.now();
    final current = DateTime.tryParse(str(form['dateOfBirth']));
    final last = DateTime(now.year - 18, now.month, now.day);
    final first = DateTime(now.year - 80, now.month, now.day);
    var initial = current ?? DateTime(now.year - 35);
    if (initial.isAfter(last)) initial = last;
    if (initial.isBefore(first)) initial = first;
    final d = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (d != null) {
      set('dateOfBirth', '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final p = widget.profile;
    final name = _once('fullName', p.nameChangedAt);
    final dob = _once('dateOfBirth', p.dobChangedAt);
    final religion = _once('religion', p.religionChangedAt);
    final children = integer(form['childrenCount']);
    final t = Theme.of(context).textTheme;

    return PopScope(
      canPop: !dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await confirm(context,
            title: 'Discard your changes?', body: 'You have changes that are not saved.', yes: 'Discard', danger: true);
        if (leave && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My profile'),
          actions: [
            if (dirty)
              TextButton(
                onPressed: saving ? null : _save,
                child: saving
                    ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Save'),
              ),
          ],
        ),
        body: GestureDetector(
          onTap: () => FocusScope.of(context).unfocus(),
          child: ListView(
            padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 100),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            children: [
              ContentWidth(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (widget.welcome && !(me?.profileComplete ?? true)) ...[
                      const Notice('Let us finish your profile. Others will see you as soon as the steps below are done.',
                          title: 'Welcome to 2ndShaadi', tone: PillTone.ok, icon: Icons.celebration_outlined),
                      const SizedBox(height: 12),
                    ],
                    if (me != null && !me.profileComplete) ...[
                      SectionCard(
                        title: 'Complete your profile to start matching',
                        hint: 'Members only see people who have completed their profile — it keeps 2ndShaadi genuine.',
                        child: Column(children: [
                          for (final s in me.completionSteps)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Row(children: [
                                Icon(s.done ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
                                    size: 20, color: s.done ? C.ok : C.lineStrong),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(s.label,
                                      style: TextStyle(
                                          color: s.done ? C.ink3 : C.ink,
                                          decoration: s.done ? TextDecoration.lineThrough : null)),
                                ),
                              ]),
                            ),
                        ]),
                      ),
                      const SizedBox(height: 12),
                    ],
                    SectionCard(
                      title: 'Photos',
                      hint: 'Your first photo appears on your card.',
                      child: _PhotoManager(photos: p.photos),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Basic details',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const FieldLabel('Full name'),
                        TextField(
                          controller: _c['fullName'],
                          enabled: !name.locked,
                          maxLength: 100,
                          textCapitalization: TextCapitalization.words,
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(
                            counterText: '',
                            errorText: tried && _c['fullName']!.text.trim().length < 2 ? 'Please enter your full name.' : null,
                          ),
                        ),
                        FieldHint(['Others see only your first name and initial.', ?name.hint].join(' ')),
                        const SizedBox(height: 14),
                        PickerField(
                          label: 'Date of birth',
                          value: DateTime.tryParse(str(form['dateOfBirth'])) == null
                              ? null
                              : date(DateTime.tryParse(str(form['dateOfBirth']))),
                          hint: dob.hint,
                          enabled: !dob.locked,
                          onTap: () => _pickDob(dob.locked),
                        ),
                        const SizedBox(height: 14),
                        PickerField(
                          label: 'Height',
                          value: height(intN(form['heightCm'])),
                          onTap: () async {
                            final v = await pickOne<int>(context,
                                title: 'Height',
                                options: [for (final h in heightOptions) (h, heightLabel(h))],
                                current: intN(form['heightCm']));
                            if (v != null) set('heightCm', v);
                          },
                        ),
                        const SizedBox(height: 14),
                        const FieldLabel('Marital status'),
                        ChoiceChips<String>(
                          options: [for (final e in marital.entries) (e.key, e.value)],
                          selected: {if (form['maritalStatus'] != null) '${form['maritalStatus']}'},
                          onChanged: (v) {
                            if (v.isNotEmpty) set('maritalStatus', v.first);
                          },
                        ),
                        const SizedBox(height: 14),
                        PickerField(
                          label: 'Religion',
                          value: strN(form['religion']),
                          hint: religion.hint,
                          enabled: !religion.locked,
                          onTap: () async {
                            final v = await pickOne<String>(context,
                                title: 'Religion', options: [for (final r in religions) (r, r)], current: strN(form['religion']));
                            if (v != null) set('religion', v);
                          },
                        ),
                        const SizedBox(height: 14),
                        const FieldLabel('Community / caste', optional: true),
                        TextField(controller: _c['community'], maxLength: 50, onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(counterText: '')),
                        const SizedBox(height: 14),
                        PickerField(
                          label: 'Mother tongue',
                          value: strN(form['motherTongue']),
                          onTap: () async {
                            final v = await pickOne<String>(context,
                                title: 'Mother tongue',
                                options: [for (final r in languages) (r, r)],
                                current: strN(form['motherTongue']));
                            if (v != null) set('motherTongue', v);
                          },
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Where you live',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (!kIsWeb)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: AppButton(
                              label: 'Use my current location',
                              icon: Icons.my_location_rounded,
                              variant: ButtonVariant.soft,
                              dense: true,
                              loading: locating,
                              onPressed: _useLocation,
                            ),
                          ),
                        const FieldLabel('City'),
                        TextField(
                          controller: _c['city'],
                          maxLength: 80,
                          autofillHints: const [AutofillHints.addressCity],
                          textCapitalization: TextCapitalization.words,
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(counterText: ''),
                        ),
                        const SizedBox(height: 14),
                        PickerField(
                          label: 'State',
                          value: strN(form['state']),
                          onTap: () async {
                            final v = await pickOne<String>(context,
                                title: 'State', options: [for (final s in states) (s, s)], current: strN(form['state']));
                            if (v != null) set('state', v);
                          },
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Education and work',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const FieldLabel('Highest education'),
                        TextField(controller: _c['education'], maxLength: 100, onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(counterText: '', hintText: 'e.g. B.Com, MBA')),
                        const SizedBox(height: 14),
                        const FieldLabel('Profession'),
                        TextField(controller: _c['profession'], maxLength: 100, onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(counterText: '', hintText: 'e.g. Teacher')),
                        const SizedBox(height: 14),
                        const FieldLabel('Annual income (₹ lakh)', optional: true),
                        TextField(
                          controller: _c['incomeLpa'],
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                          onChanged: (_) => setState(() {}),
                        ),
                        const FieldHint('Shown as a figure, e.g. ₹12 lakh a year. 0 means not working.'),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Family',
                      hint: 'Being open about children helps you find the right person.',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const FieldLabel('Number of children'),
                        ChoiceChips<int>(
                          options: [for (var i = 0; i <= 5; i++) (i, i == 0 ? 'None' : '$i')],
                          selected: {children},
                          onChanged: (v) {
                            if (v.isNotEmpty) set('childrenCount', v.first);
                          },
                        ),
                        if (children > 0)
                          ToggleRow(
                            label: 'My children live with me',
                            value: boolean(form['childrenLiveWithMe']),
                            onChanged: (v) => set('childrenLiveWithMe', v),
                          ),
                        const SizedBox(height: 8),
                        const FieldLabel('Would you like (more) children?'),
                        ChoiceChips<bool>(
                          options: const [(true, 'Yes'), (false, 'No')],
                          selected: {if (form['wantsMoreChildren'] is bool) form['wantsMoreChildren'] as bool},
                          onChanged: (v) => set('wantsMoreChildren', v.firstOrNull),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Lifestyle',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const FieldLabel('Diet'),
                        ChoiceChips<String>(
                          options: [for (final e in diets.entries) (e.key, e.value)],
                          selected: {if (form['diet'] != null) '${form['diet']}'},
                          onChanged: (v) => set('diet', v.firstOrNull),
                        ),
                        const SizedBox(height: 14),
                        const FieldLabel('Smoke'),
                        ChoiceChips<String>(
                          options: [for (final e in habits.entries) (e.key, e.value)],
                          selected: {if (form['smoking'] != null) '${form['smoking']}'},
                          onChanged: (v) => set('smoking', v.firstOrNull),
                        ),
                        const SizedBox(height: 14),
                        const FieldLabel('Drink'),
                        ChoiceChips<String>(
                          options: [for (final e in habits.entries) (e.key, e.value)],
                          selected: {if (form['drinking'] != null) '${form['drinking']}'},
                          onChanged: (v) => set('drinking', v.firstOrNull),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'In your own words',
                      hint: 'This is what people read first. Be honest and specific.',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const FieldLabel('About you'),
                        TextField(
                          controller: _c['aboutMe'],
                          minLines: 5,
                          maxLines: 12,
                          maxLength: 2000,
                          textCapitalization: TextCapitalization.sentences,
                          onChanged: (_) => setState(() {}),
                        ),
                        FieldHint(
                            'At least ${ref.watch(siteConfigProvider).aboutMinLength} characters. Your work, family, what a good day looks like.'),
                        const SizedBox(height: 14),
                        const FieldLabel('What you are looking for', optional: true),
                        TextField(
                          controller: _c['lookingFor'],
                          minLines: 3,
                          maxLines: 8,
                          maxLength: 1000,
                          textCapitalization: TextCapitalization.sentences,
                          onChanged: (_) => setState(() {}),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Visibility',
                      child: ToggleRow(
                        label: 'Hide my profile',
                        description:
                            'You will not appear in search. People you are already connected with can still see you and message you.',
                        value: boolean(form['isHidden']),
                        onChanged: (v) => set('isHidden', v),
                      ),
                    ),
                    Text(' ', style: t.bodySmall),
                  ],
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: AnimatedSize(
          duration: const Duration(milliseconds: 160),
          child: !dirty
              ? const SizedBox(width: double.infinity)
              : Material(
                  color: C.surface,
                  child: SafeArea(
                    top: false,
                    child: Container(
                      decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                      child: Row(children: [
                        const Expanded(
                          child: Text('Unsaved changes', style: TextStyle(color: C.gold, fontWeight: FontWeight.w600)),
                        ),
                        AppButton(
                          label: 'Discard',
                          variant: ButtonVariant.ghost,
                          dense: true,
                          onPressed: () => setState(() {
                            form = {...saved};
                            for (final k in _textKeys) {
                              _c[k]!.text = form[k] == null ? '' : '${form[k]}';
                            }
                          }),
                        ),
                        const SizedBox(width: 6),
                        AppButton(label: 'Save changes', dense: true, loading: saving, onPressed: _save),
                      ]),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

/// Add (camera or gallery), delete and reorder the main photo.
class _PhotoManager extends ConsumerStatefulWidget {
  const _PhotoManager({required this.photos});
  final List<String> photos;
  @override
  ConsumerState<_PhotoManager> createState() => _PhotoManagerState();
}

class _PhotoManagerState extends ConsumerState<_PhotoManager> {
  bool busy = false;
  int uploading = 0;

  Future<void> _done() async {
    ref.invalidate(myProfileProvider);
    await ref.read(sessionProvider.notifier).reloadMe();
  }

  Future<void> _add(int max) async {
    final files = await pickPhotos(context, max: max);
    if (files.isEmpty || !mounted) return;
    setState(() {
      busy = true;
      uploading = files.length;
    });
    var added = 0;
    for (final f in files) {
      try {
        final bytes = await f.readAsBytes();
        if (bytes.length > 10 * 1024 * 1024) {
          if (mounted) toast(context, 'That photo is larger than 10 MB.', error: true);
          continue;
        }
        await Api.instance.upload('/profiles/me/photos', bytes, f.name.isEmpty ? 'photo.jpg' : f.name, mimeFor(f.name));
        added++;
      } catch (e) {
        if (mounted) toast(context, errorText(e), error: true);
        break;
      } finally {
        if (mounted) setState(() => uploading = uploading > 0 ? uploading - 1 : 0);
      }
    }
    await _done();
    if (!mounted) return;
    setState(() => busy = false);
    if (added > 0) toast(context, added == 1 ? 'Photo added' : '$added photos added');
  }

  @override
  Widget build(BuildContext context) {
    final max = ref.watch(siteConfigProvider).maxPhotos;
    final photos = widget.photos;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LayoutBuilder(builder: (context, box) {
          final cols = box.maxWidth >= 520 ? 4 : 3;
          final w = (box.maxWidth - (cols - 1) * 10) / cols;
          return Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (var i = 0; i < photos.length; i++)
                SizedBox(
                  width: w,
                  child: AspectRatio(
                    aspectRatio: 4 / 5,
                    child: Stack(fit: StackFit.expand, children: [
                      Photo(url: photos[i], name: 'Your photo', radius: BorderRadius.circular(12)),
                      Positioned(
                        left: 6,
                        bottom: 6,
                        child: i == 0
                            ? const Pill('Main photo', tone: PillTone.dark)
                            : GestureDetector(
                                onTap: busy
                                    ? null
                                    : () async {
                                        setState(() => busy = true);
                                        await runGuarded(context,
                                            () async => Api.instance.patch('/profiles/me/photos/main', {'url': photos[i]}));
                                        await _done();
                                        if (mounted) setState(() => busy = false);
                                      },
                                child: const Pill('Make main'),
                              ),
                      ),
                      Positioned(
                        right: 0,
                        top: 0,
                        child: IconButton(
                          tooltip: 'Delete photo',
                          onPressed: busy
                              ? null
                              : () async {
                                  if (!await confirm(context, title: 'Delete this photo?', yes: 'Delete', danger: true)) return;
                                  if (!context.mounted) return;
                                  setState(() => busy = true);
                                  await runGuarded(context, () async => Api.instance.delete('/profiles/me/photos', {'url': photos[i]}));
                                  await _done();
                                  if (mounted) setState(() => busy = false);
                                },
                          icon: const Icon(Icons.delete_outline_rounded,
                              color: Colors.white, shadows: [Shadow(blurRadius: 6, color: Colors.black54)]),
                        ),
                      ),
                    ]),
                  ),
                ),
              if (photos.length < max)
                SizedBox(
                  width: w,
                  child: AspectRatio(
                    aspectRatio: 4 / 5,
                    child: Material(
                      color: C.brandSoft.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(12),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: busy ? null : () => _add(max - photos.length),
                        child: Center(
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            if (uploading > 0)
                              const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4))
                            else
                              const Icon(Icons.add_a_photo_outlined, color: C.brand),
                            const SizedBox(height: 6),
                            Text(uploading > 0 ? 'Uploading…' : 'Add photo',
                                style: const TextStyle(color: C.brand, fontWeight: FontWeight.w600, fontSize: 13)),
                          ]),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          );
        }),
        FieldHint(
            'Up to $max clear, recent photos of yourself. A photo already used on another profile is refused. Location data inside photos is removed when you upload.'),
      ],
    );
  }
}
