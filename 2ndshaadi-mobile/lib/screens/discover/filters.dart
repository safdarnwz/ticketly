import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';

/// Partner-search filters as plain strings (lists comma separated), exactly
/// what the API's search takes. Mirrors frontend/src/lib/search-filters.ts.
typedef Filters = Map<String, String>;

const basicKeys = [
  'ageMin', 'ageMax', 'maritalStatuses', 'religions', 'communities', 'motherTongues', 'city', 'states', //
  'children', 'joinedWithinDays', 'hideContacted', 'hideViewed', 'minScore',
];
const advancedKeys = [
  'incomeMin', 'incomeMax', 'heightMin', 'heightMax', 'education', 'profession', 'keyword', 'diets', //
  'nonSmoker', 'nonDrinker', 'withPhoto', 'activeWithinDays',
];

const childrenFilter = {
  'NONE': 'No children',
  'UP_TO_1': 'Up to 1 child',
  'NOT_LIVING_WITH': 'Children not living with them',
};

/// Groups shown as one removable chip, and the keys each covers.
const filterGroups = [
  ('age', ['ageMin', 'ageMax'], 'Age'),
  ('maritalStatuses', ['maritalStatuses'], 'Marital status'),
  ('religions', ['religions'], 'Religion'),
  ('communities', ['communities'], 'Community'),
  ('motherTongues', ['motherTongues'], 'Mother tongue'),
  ('city', ['city'], 'City'),
  ('states', ['states'], 'State'),
  ('children', ['children'], 'Children'),
  ('joinedWithinDays', ['joinedWithinDays'], 'Joined recently'),
  ('hideContacted', ['hideContacted'], 'Not contacted yet'),
  ('hideViewed', ['hideViewed'], 'Not viewed yet'),
  ('minScore', ['minScore'], 'Strong matches only'),
  ('income', ['incomeMin', 'incomeMax'], 'Income'),
  ('height', ['heightMin', 'heightMax'], 'Height'),
  ('education', ['education'], 'Education'),
  ('profession', ['profession'], 'Profession'),
  ('keyword', ['keyword'], 'Keyword'),
  ('diets', ['diets'], 'Diet'),
  ('nonSmoker', ['nonSmoker'], 'Non-smoker'),
  ('nonDrinker', ['nonDrinker'], 'Non-drinker'),
  ('withPhoto', ['withPhoto'], 'With photo'),
  ('activeWithinDays', ['activeWithinDays'], 'Recently active'),
];

List<String> splitList(String? v) =>
    (v ?? '').split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();

List<String> activeGroups(Filters f) =>
    [for (final g in filterGroups) if (g.$2.any((k) => (f[k] ?? '').isNotEmpty)) g.$1];

String? groupLabel(String id, Filters f) {
  final g = filterGroups.where((x) => x.$1 == id).firstOrNull;
  if (g == null || !g.$2.any((k) => (f[k] ?? '').isNotEmpty)) return null;
  String range(String? a, String? b, String Function(String) fmt, [String unit = '']) {
    if ((a ?? '').isNotEmpty && (b ?? '').isNotEmpty) return '${fmt(a!)}–${fmt(b!)}$unit';
    if ((a ?? '').isNotEmpty) return '${fmt(a!)}+$unit';
    return 'Up to ${fmt(b!)}$unit';
  }

  String many(String? v, [String Function(String)? label]) {
    final xs = splitList(v).map(label ?? (x) => x).toList();
    return xs.length > 2 ? '${xs.take(2).join(', ')} +${xs.length - 2}' : xs.join(', ');
  }

  switch (id) {
    case 'age':
      return range(f['ageMin'], f['ageMax'], (v) => v, ' yrs');
    case 'maritalStatuses':
      return many(f['maritalStatuses'], (x) => marital[x] ?? x);
    case 'children':
      return childrenFilter[f['children']];
    case 'joinedWithinDays':
      return 'Joined in last ${f['joinedWithinDays']} days';
    case 'minScore':
      return '${f['minScore']}%+ match';
    case 'income':
      return range(f['incomeMin'], f['incomeMax'], (v) => '₹${v}L', ' a year');
    case 'height':
      return range(f['heightMin'], f['heightMax'], (v) => height(int.tryParse(v)) ?? v);
    case 'education':
      return 'Education: ${f['education']}';
    case 'profession':
      return 'Profession: ${f['profession']}';
    case 'keyword':
      return '“${f['keyword']}”';
    case 'diets':
      return many(f['diets'], (x) => diets[x] ?? x);
    case 'activeWithinDays':
      return f['activeWithinDays'] == '1' ? 'Active today' : 'Active in last ${f['activeWithinDays']} days';
    case 'city':
      return 'City: ${f['city']}';
    case 'religions':
    case 'communities':
    case 'motherTongues':
    case 'states':
      return many(f[id]);
    default:
      return g.$3;
  }
}

const _intRanges = {
  'ageMin': (18, 80),
  'ageMax': (18, 80),
  'incomeMin': (0, 1000),
  'incomeMax': (0, 1000),
  'heightMin': (120, 230),
  'heightMax': (120, 230),
};

/// Tidies filters: numbers kept in range, blanks dropped.
Filters cleanFilters(Filters f) {
  final out = <String, String>{};
  for (final k in [...basicKeys, ...advancedKeys]) {
    var v = (f[k] ?? '').trim();
    if (v.isEmpty) continue;
    final r = _intRanges[k];
    if (r != null) {
      final n = num.tryParse(v)?.round();
      if (n == null) continue;
      v = '${n.clamp(r.$1, r.$2)}';
    }
    out[k] = v;
  }
  return out;
}

/// Filters from the member's partner preferences (paid filters only when the plan has them).
Filters fromPreferences(Json p, bool advanced) {
  final f = <String, String>{'ageMin': '${integer(p['ageMin'], 25)}', 'ageMax': '${integer(p['ageMax'], 45)}'};
  void list(String key, String from) {
    final xs = strList(p[from]);
    if (xs.isNotEmpty) f[key] = xs.take(10).join(',');
  }

  list('maritalStatuses', 'maritalStatuses');
  list('religions', 'religions');
  list('motherTongues', 'motherTongues');
  list('states', 'states');
  final cities = strList(p['cities']);
  if (cities.length == 1) f['city'] = cities.first;
  if (p['children'] == 'NO_CHILDREN') f['children'] = 'NONE';
  if (advanced) {
    if (intN(p['heightMinCm']) != null) f['heightMin'] = '${p['heightMinCm']}';
    if (intN(p['heightMaxCm']) != null) f['heightMax'] = '${p['heightMaxCm']}';
    if (intN(p['minIncomeLpa']) != null) f['incomeMin'] = '${p['minIncomeLpa']}';
    list('diets', 'diets');
    if (boolean(p['nonSmokerOnly'])) f['nonSmoker'] = 'true';
    if (boolean(p['nonDrinkerOnly'])) f['nonDrinker'] = 'true';
  }
  return f;
}

/// Full-screen sheet with every filter. Paid filters are shown locked on free plans.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key, required this.initial, required this.advanced});
  final Filters initial;
  final bool advanced;
  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  late Filters f = {...widget.initial};
  late final _text = {
    for (final k in ['communities', 'city', 'education', 'profession', 'keyword', 'incomeMin', 'incomeMax'])
      k: TextEditingController(text: widget.initial[k] ?? ''),
  };
  bool loadingPrefs = false;

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  void set(String k, String? v) => setState(() => (v == null || v.isEmpty) ? f.remove(k) : f[k] = v);
  Set<String> listOf(String k) => splitList(f[k]).toSet();
  void setList(String k, Set<String> v) => set(k, v.join(','));
  bool flag(String k) => f[k] == 'true';

  Filters _collect() {
    final out = {...f};
    _text.forEach((k, c) {
      final v = c.text.trim();
      if (v.isEmpty) {
        out.remove(k);
      } else {
        out[k] = v;
      }
    });
    if (!widget.advanced) {
      for (final k in advancedKeys) {
        out.remove(k);
      }
    }
    return cleanFilters(out);
  }

  Future<void> _usePreferences() async {
    setState(() => loadingPrefs = true);
    try {
      final p = await ref.read(preferencesProvider.future);
      final next = fromPreferences(p, widget.advanced);
      if (!mounted) return;
      setState(() {
        f = next;
        _text.forEach((k, c) => c.text = next[k] ?? '');
      });
    } catch (e) {
      if (mounted) toast(context, 'Could not load your preferences.', error: true);
    } finally {
      if (mounted) setState(() => loadingPrefs = false);
    }
  }

  Future<void> _pickNumber(String key, String title, List<int> values, String Function(int) label) async {
    final v = await pickOne<int>(
      context,
      title: title,
      options: [(-1, 'Any'), for (final x in values) (x, label(x))],
      current: int.tryParse(f[key] ?? '') ?? -1,
    );
    if (!mounted || v == null) return; // closed without choosing
    set(key, v < 0 ? null : '$v');
  }

  Future<void> _pickStates() async {
    final chosen = await showAppSheet<Set<String>>(
      context,
      full: true,
      builder: (c) => _MultiPick(title: 'States', options: states, initial: listOf('states'), max: 10),
    );
    if (chosen != null) setList('states', chosen);
  }

  @override
  Widget build(BuildContext context) {
    final adv = widget.advanced;
    final ages = [for (var a = 18; a <= 80; a++) a];
    final t = Theme.of(context).textTheme;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 8, 4),
          child: Row(
            children: [
              Expanded(child: Text('Filter matches', style: t.titleLarge)),
              TextButton(
                onPressed: loadingPrefs ? null : _usePreferences,
                child: Text(loadingPrefs ? 'Loading…' : 'Use my preferences'),
              ),
            ],
          ),
        ),
        const Divider(),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              _label('Age'),
              Row(children: [
                Expanded(
                  child: PickerField(
                    label: 'From',
                    value: f['ageMin'],
                    placeholder: 'Any',
                    onTap: () => _pickNumber('ageMin', 'Minimum age', ages, (x) => '$x'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: PickerField(
                    label: 'To',
                    value: f['ageMax'],
                    placeholder: 'Any',
                    onTap: () => _pickNumber('ageMax', 'Maximum age', ages, (x) => '$x'),
                  ),
                ),
              ]),
              _label('Marital status'),
              ChoiceChips<String>(
                multiple: true,
                options: [for (final e in marital.entries) (e.key, e.value)],
                selected: listOf('maritalStatuses'),
                onChanged: (v) => setList('maritalStatuses', v),
              ),
              _label('Religion'),
              ChoiceChips<String>(
                multiple: true,
                options: [for (final r in religions) (r, r)],
                selected: listOf('religions'),
                onChanged: (v) => setList('religions', v),
              ),
              _label('Mother tongue'),
              ChoiceChips<String>(
                multiple: true,
                options: [for (final r in languages) (r, r)],
                selected: listOf('motherTongues'),
                onChanged: (v) => setList('motherTongues', v),
              ),
              _field('communities', 'Community / caste', hint: 'Separate with commas. Leave empty for any.'),
              _field('city', 'City', hint: 'Starts with, e.g. “Nav” finds Navi Mumbai.'),
              const SizedBox(height: 14),
              PickerField(
                label: 'States',
                value: listOf('states').isEmpty ? null : listOf('states').join(', '),
                placeholder: 'Anywhere',
                onTap: _pickStates,
              ),
              _label('Children'),
              ChoiceChips<String>(
                options: [for (final e in childrenFilter.entries) (e.key, e.value)],
                selected: {if (f['children'] != null) f['children']!},
                onChanged: (v) => set('children', v.firstOrNull),
              ),
              _label('Joined'),
              ChoiceChips<String>(
                options: const [('7', 'Last 7 days'), ('30', 'Last 30 days'), ('90', 'Last 90 days')],
                selected: {if (f['joinedWithinDays'] != null) f['joinedWithinDays']!},
                onChanged: (v) => set('joinedWithinDays', v.firstOrNull),
              ),
              const SizedBox(height: 8),
              ToggleRow(
                label: 'People I have not contacted yet',
                value: flag('hideContacted'),
                onChanged: (v) => set('hideContacted', v ? 'true' : null),
              ),
              ToggleRow(
                label: 'Profiles I have not opened yet',
                value: flag('hideViewed'),
                onChanged: (v) => set('hideViewed', v ? 'true' : null),
              ),
              ToggleRow(
                label: 'Strong matches only',
                description: '70% match or more',
                value: f['minScore'] == '70',
                onChanged: (v) => set('minScore', v ? '70' : null),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Text('More filters', style: t.titleMedium),
                  const SizedBox(width: 8),
                  if (!adv) const Pill('Paid plans', tone: PillTone.gold, icon: Icons.lock_rounded),
                ],
              ),
              if (!adv) ...[
                const SizedBox(height: 8),
                const LockedNote('Income, height, education, diet, recent activity and keyword search are part of paid plans.'),
              ],
              AbsorbPointer(
                absorbing: !adv,
                child: Opacity(
                  opacity: adv ? 1 : 0.45,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _field('keyword', 'Keyword', hint: 'Words in their profile, e.g. “teacher”, “Pune”.'),
                      _field('profession', 'Profession contains'),
                      _field('education', 'Education contains'),
                      _label('Income (₹ lakh a year)'),
                      Row(children: [
                        Expanded(child: _number('incomeMin', 'Minimum')),
                        const SizedBox(width: 12),
                        Expanded(child: _number('incomeMax', 'Maximum')),
                      ]),
                      _label('Height'),
                      Row(children: [
                        Expanded(
                          child: PickerField(
                            label: 'From',
                            value: height(int.tryParse(f['heightMin'] ?? '')),
                            placeholder: 'Any',
                            onTap: () => _pickNumber('heightMin', 'Minimum height', heightOptions, heightLabel),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: PickerField(
                            label: 'To',
                            value: height(int.tryParse(f['heightMax'] ?? '')),
                            placeholder: 'Any',
                            onTap: () => _pickNumber('heightMax', 'Maximum height', heightOptions, heightLabel),
                          ),
                        ),
                      ]),
                      _label('Diet'),
                      ChoiceChips<String>(
                        multiple: true,
                        options: [for (final e in diets.entries) (e.key, e.value)],
                        selected: listOf('diets'),
                        onChanged: (v) => setList('diets', v),
                      ),
                      _label('Last active'),
                      ChoiceChips<String>(
                        options: const [('1', 'Today'), ('3', '3 days'), ('7', 'A week'), ('30', 'A month')],
                        selected: {if (f['activeWithinDays'] != null) f['activeWithinDays']!},
                        onChanged: (v) => set('activeWithinDays', v.firstOrNull),
                      ),
                      const SizedBox(height: 8),
                      ToggleRow(label: 'Non-smoker', value: flag('nonSmoker'), onChanged: (v) => set('nonSmoker', v ? 'true' : null)),
                      ToggleRow(label: 'Non-drinker', value: flag('nonDrinker'), onChanged: (v) => set('nonDrinker', v ? 'true' : null)),
                      ToggleRow(label: 'With photo', value: flag('withPhoto'), onChanged: (v) => set('withPhoto', v ? 'true' : null)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const Divider(),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            child: Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Reset',
                    variant: ButtonVariant.secondary,
                    onPressed: () => Navigator.pop(context, <String, String>{}),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: AppButton(label: 'Show matches', onPressed: () => Navigator.pop(context, _collect())),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(top: 18, bottom: 8),
        child: Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: C.ink)),
      );

  Widget _field(String key, String label, {String? hint}) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            FieldLabel(label),
            TextField(controller: _text[key], maxLength: 80, decoration: const InputDecoration(counterText: '')),
            if (hint != null) FieldHint(hint),
          ],
        ),
      );

  Widget _number(String key, String hint) => TextField(
        controller: _text[key],
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
        decoration: InputDecoration(hintText: hint),
      );
}

/// Pick several values from a list (states).
class _MultiPick extends StatefulWidget {
  const _MultiPick({required this.title, required this.options, required this.initial, this.max = 99});
  final String title;
  final List<String> options;
  final Set<String> initial;
  final int max;
  @override
  State<_MultiPick> createState() => _MultiPickState();
}

class _MultiPickState extends State<_MultiPick> {
  late final Set<String> chosen = {...widget.initial};
  String q = '';
  @override
  Widget build(BuildContext context) {
    final shown = widget.options.where((o) => o.toLowerCase().contains(q.toLowerCase())).toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 8, 0),
          child: Row(children: [
            Expanded(child: Text(widget.title, style: Theme.of(context).textTheme.titleLarge)),
            TextButton(onPressed: () => setState(chosen.clear), child: const Text('Clear')),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            decoration: const InputDecoration(hintText: 'Search', prefixIcon: Icon(Icons.search)),
            onChanged: (v) => setState(() => q = v.trim()),
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: shown.length,
            itemBuilder: (c, i) {
              final o = shown[i];
              final on = chosen.contains(o);
              return CheckboxListTile(
                value: on,
                title: Text(o),
                activeColor: C.button,
                onChanged: (v) {
                  if (v == true && chosen.length >= widget.max) {
                    toast(context, 'Choose up to ${widget.max}.');
                    return;
                  }
                  setState(() => v == true ? chosen.add(o) : chosen.remove(o));
                },
              );
            },
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: AppButton(label: 'Done', expand: true, onPressed: () => Navigator.pop(context, chosen)),
          ),
        ),
      ],
    );
  }
}
