import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';

const _keys = [
  'ageMin', 'ageMax', 'heightMinCm', 'heightMaxCm', 'maritalStatuses', 'religions', 'religionIsMust', 'motherTongues', //
  'cities', 'states', 'minIncomeLpa', 'diets', 'nonSmokerOnly', 'nonDrinkerOnly', 'children', 'aboutPartner',
];

class PreferencesScreen extends ConsumerWidget {
  const PreferencesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(preferencesProvider);
    return data.when(
      skipLoadingOnRefresh: true,
      loading: () => Scaffold(appBar: AppBar(title: const Text('Partner preferences')), body: const ListSkeleton(rows: 6, height: 90)),
      error: (e, _) => Scaffold(
        appBar: AppBar(title: const Text('Partner preferences')),
        body: ErrorState(error: e, onRetry: () => ref.invalidate(preferencesProvider)),
      ),
      data: (p) => _Editor(initial: p),
    );
  }
}

class _Editor extends ConsumerStatefulWidget {
  const _Editor({required this.initial});
  final Json initial;
  @override
  ConsumerState<_Editor> createState() => _EditorState();
}

class _EditorState extends ConsumerState<_Editor> {
  late Json saved = {for (final k in _keys) k: widget.initial[k]};
  late Json f = {...saved};
  late final _about = TextEditingController(text: str(saved['aboutPartner']));
  final _city = TextEditingController();
  bool saving = false;

  @override
  void dispose() {
    _about.dispose();
    _city.dispose();
    super.dispose();
  }

  Json get _current => {...f, 'aboutPartner': _about.text.trim().isEmpty ? null : _about.text.trim()};
  bool get dirty => jsonEncode(_current) != jsonEncode(saved);
  Set<String> listOf(String k) => strList(f[k]).toSet();
  void set(String k, Object? v) => setState(() => f[k] = v);

  String? get _error {
    if (integer(f['ageMin']) > integer(f['ageMax'])) return 'Minimum age is higher than maximum age.';
    final a = intN(f['heightMinCm']), b = intN(f['heightMaxCm']);
    if (a != null && b != null && a > b) return 'Minimum height is more than maximum height.';
    return null;
  }

  Future<void> _save() async {
    if (_error != null) return toast(context, _error!, error: true);
    final cur = _current;
    final changed = {for (final k in _keys) if (jsonEncode(cur[k]) != jsonEncode(saved[k])) k: cur[k]};
    if (changed.isEmpty) return;
    setState(() => saving = true);
    try {
      final r = asMap(await Api.instance.patch('/preferences/me', changed));
      ref.invalidate(searchProvider);
      if (!mounted) return;
      setState(() {
        saved = {for (final k in _keys) k: r[k]};
        f = {...saved};
        _about.text = str(saved['aboutPartner']);
      });
      ref.invalidate(preferencesProvider);
      toast(context, 'Preferences saved. Your matches are updated.');
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _pickInt(String key, String title, List<int> values, String Function(int) label, {bool any = true}) async {
    final v = await pickOne<int>(context,
        title: title, options: [if (any) (-1, 'Any'), for (final x in values) (x, label(x))], current: intN(f[key]) ?? -1);
    if (v == null) return;
    set(key, v < 0 ? null : v);
  }

  @override
  Widget build(BuildContext context) {
    final ages = [for (var a = 18; a <= 80; a++) a];
    Widget row(String title, Widget child, {String? hint}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: SectionCard(title: title, hint: hint, child: child),
        );
    return PopScope(
      canPop: !dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await confirm(context, title: 'Discard your changes?', yes: 'Discard', danger: true) && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Partner preferences')),
        body: ListView(
          padding: EdgeInsets.fromLTRB(S.gutter, 4, S.gutter, MediaQuery.paddingOf(context).bottom + 100),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            ContentWidth(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                      'Used to rank profiles and to show how well you match. Fewer must-haves means more people to meet.',
                      style: TextStyle(color: C.ink2)),
                ),
                if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Notice(_error!, tone: PillTone.danger)),
                row(
                  'Age',
                  Row(children: [
                    Expanded(
                      child: PickerField(
                        label: 'From',
                        value: '${integer(f['ageMin'], 18)}',
                        onTap: () => _pickInt('ageMin', 'Minimum age', ages, (x) => '$x', any: false),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: PickerField(
                        label: 'To',
                        value: '${integer(f['ageMax'], 80)}',
                        onTap: () => _pickInt('ageMax', 'Maximum age', ages, (x) => '$x', any: false),
                      ),
                    ),
                  ]),
                ),
                row(
                  'Height',
                  Row(children: [
                    Expanded(
                      child: PickerField(
                        label: 'From',
                        value: height(intN(f['heightMinCm'])),
                        placeholder: 'Any',
                        onTap: () => _pickInt('heightMinCm', 'Minimum height', heightOptions, heightLabel),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: PickerField(
                        label: 'To',
                        value: height(intN(f['heightMaxCm'])),
                        placeholder: 'Any',
                        onTap: () => _pickInt('heightMaxCm', 'Maximum height', heightOptions, heightLabel),
                      ),
                    ),
                  ]),
                  hint: 'Leave empty if it does not matter.',
                ),
                row(
                  'Marital status',
                  ChoiceChips<String>(
                    multiple: true,
                    options: [for (final e in marital.entries) (e.key, e.value)],
                    selected: listOf('maritalStatuses'),
                    onChanged: (v) => set('maritalStatuses', v.toList()),
                  ),
                  hint: 'None selected means any.',
                ),
                row(
                  'Religion',
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ChoiceChips<String>(
                      multiple: true,
                      options: [for (final r in religions) (r, r)],
                      selected: listOf('religions'),
                      onChanged: (v) => set('religions', v.toList()),
                    ),
                    if (listOf('religions').isNotEmpty)
                      ToggleRow(
                        label: 'This is a must',
                        description: 'People outside these religions will rank much lower.',
                        value: boolean(f['religionIsMust']),
                        onChanged: (v) => set('religionIsMust', v),
                      ),
                  ]),
                  hint: 'None selected means any.',
                ),
                row(
                  'Mother tongue',
                  ChoiceChips<String>(
                    multiple: true,
                    options: [for (final r in languages) (r, r)],
                    selected: listOf('motherTongues'),
                    onChanged: (v) => set('motherTongues', v.toList()),
                  ),
                  hint: 'None selected means any.',
                ),
                row(
                  'Location',
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const FieldLabel('Cities'),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final c in strList(f['cities']))
                        InputChip(label: Text(c), onDeleted: () => set('cities', strList(f['cities'])..remove(c))),
                    ]),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _city,
                      textCapitalization: TextCapitalization.words,
                      decoration: InputDecoration(
                        hintText: 'Type a city and press add',
                        suffixIcon: IconButton(
                          icon: const Icon(Icons.add_rounded),
                          onPressed: () => _addCity(),
                        ),
                      ),
                      onSubmitted: (_) => _addCity(),
                    ),
                    const SizedBox(height: 14),
                    PickerField(
                      label: 'States',
                      value: listOf('states').isEmpty ? null : listOf('states').join(', '),
                      placeholder: 'Anywhere',
                      onTap: () async {
                        final v = await showAppSheet<Set<String>>(
                          context,
                          full: true,
                          builder: (c) => _StatesPick(initial: listOf('states')),
                        );
                        if (v != null) set('states', v.toList());
                      },
                    ),
                  ]),
                  hint: 'Empty means anywhere.',
                ),
                row(
                  'Children',
                  ChoiceChips<String>(
                    options: [for (final e in childrenPref.entries) (e.key, e.value)],
                    selected: {str(f['children'], 'ANY')},
                    onChanged: (v) => set('children', v.firstOrNull ?? 'ANY'),
                  ),
                  hint: 'About children they already have.',
                ),
                row(
                  'Lifestyle',
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const FieldLabel('Diet'),
                    ChoiceChips<String>(
                      multiple: true,
                      options: [for (final e in diets.entries) (e.key, e.value)],
                      selected: listOf('diets'),
                      onChanged: (v) => set('diets', v.toList()),
                    ),
                    ToggleRow(label: 'Non-smoker only', value: boolean(f['nonSmokerOnly']), onChanged: (v) => set('nonSmokerOnly', v)),
                    ToggleRow(
                        label: 'Non-drinker preferred', value: boolean(f['nonDrinkerOnly']), onChanged: (v) => set('nonDrinkerOnly', v)),
                  ]),
                ),
                row(
                  'Income',
                  PickerField(
                    label: 'Minimum annual income',
                    value: intN(f['minIncomeLpa']) == null ? null : '₹${f['minIncomeLpa']} lakh or more',
                    placeholder: 'Does not matter',
                    onTap: () => _pickInt('minIncomeLpa', 'Minimum income', const [3, 5, 8, 10, 15, 20, 30, 50], (n) => '₹$n lakh or more'),
                  ),
                ),
                row(
                  'In your words',
                  TextField(controller: _about, minLines: 3, maxLines: 8, maxLength: 1000, onChanged: (_) => setState(() {})),
                  hint: 'Optional. Shown to no one; it helps you think.',
                ),
              ]),
            ),
          ],
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
                        const Expanded(child: Text('Unsaved changes', style: TextStyle(color: C.gold, fontWeight: FontWeight.w600))),
                        AppButton(
                          label: 'Discard',
                          variant: ButtonVariant.ghost,
                          dense: true,
                          onPressed: () => setState(() {
                            f = {...saved};
                            _about.text = str(saved['aboutPartner']);
                          }),
                        ),
                        const SizedBox(width: 6),
                        AppButton(label: 'Save', dense: true, loading: saving, onPressed: _save),
                      ]),
                    ),
                  ),
                ),
        ),
      ),
    );
  }

  void _addCity() {
    final c = _city.text.trim();
    if (c.isEmpty) return;
    final list = strList(f['cities']);
    if (list.length >= 10) return toast(context, 'Up to 10 cities.');
    if (!list.map((x) => x.toLowerCase()).contains(c.toLowerCase())) set('cities', [...list, c]);
    _city.clear();
  }
}

class _StatesPick extends StatefulWidget {
  const _StatesPick({required this.initial});
  final Set<String> initial;
  @override
  State<_StatesPick> createState() => _StatesPickState();
}

class _StatesPickState extends State<_StatesPick> {
  late final chosen = {...widget.initial};
  @override
  Widget build(BuildContext context) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 8, 0),
          child: Row(children: [
            Expanded(child: Text('States', style: Theme.of(context).textTheme.titleLarge)),
            TextButton(onPressed: () => setState(chosen.clear), child: const Text('Clear')),
          ]),
        ),
        Expanded(
          child: ListView(children: [
            for (final s in states)
              CheckboxListTile(
                value: chosen.contains(s),
                title: Text(s),
                activeColor: C.button,
                onChanged: (v) => setState(() => v == true ? chosen.add(s) : chosen.remove(s)),
              ),
          ]),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: AppButton(label: 'Done', expand: true, onPressed: () => Navigator.pop(context, chosen)),
          ),
        ),
      ]);
}
