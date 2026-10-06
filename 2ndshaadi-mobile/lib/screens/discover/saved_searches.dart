import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/json.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../widgets/common.dart';
import 'filters.dart';

String describe(Filters f, [int max = 4]) {
  final parts = activeGroups(f).map((id) => groupLabel(id, f)).whereType<String>().toList();
  return parts.length > max ? '${parts.take(max).join(' · ')} · +${parts.length - max} more' : parts.join(' · ');
}

/// Save the current filters with a name, and optionally get told about new matches.
Future<void> showSaveSearch(BuildContext context, Filters filters) =>
    showAppSheet<void>(context, builder: (c) => _SaveSearch(filters: filters));

class _SaveSearch extends ConsumerStatefulWidget {
  const _SaveSearch({required this.filters});
  final Filters filters;
  @override
  ConsumerState<_SaveSearch> createState() => _SaveSearchState();
}

class _SaveSearchState extends ConsumerState<_SaveSearch> {
  late final _name = TextEditingController(text: describe(widget.filters, 2));
  bool notify = true, busy = false;

  @override
  void dispose() {
    _name.dispose();
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
          Text('Save this search', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(describe(widget.filters), style: const TextStyle(color: C.ink3, fontSize: 13)),
          const SizedBox(height: 16),
          const FieldLabel('Name'),
          TextField(controller: _name, maxLength: 60, decoration: const InputDecoration(counterText: '')),
          ToggleRow(
            label: 'Tell me about new matches',
            description: 'A notification when new members match this search.',
            value: notify,
            onChanged: (v) => setState(() => notify = v),
          ),
          const SizedBox(height: 12),
          AppButton(
            label: 'Save search',
            expand: true,
            loading: busy,
            onPressed: () async {
              final name = _name.text.trim();
              if (name.isEmpty) return toast(context, 'Please give it a name.', error: true);
              setState(() => busy = true);
              final ok = await runGuarded(context, () async {
                await Api.instance.post('/searches', {'name': name, 'filters': widget.filters, 'notify': notify});
              });
              ref.invalidate(savedSearchesProvider);
              if (!context.mounted) return;
              setState(() => busy = false);
              if (ok) {
                Navigator.pop(context);
                toast(context, 'Search saved');
              }
            },
          ),
        ],
      ),
    );
  }
}

/// Saved searches: open one, switch alerts, delete. Resolves to the filters to apply.
Future<Filters?> showSavedSearches(BuildContext context) =>
    showAppSheet<Filters>(context, full: true, builder: (c) => const _SavedList());

class _SavedList extends ConsumerWidget {
  const _SavedList();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(savedSearchesProvider);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
          child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Saved searches', style: Theme.of(context).textTheme.titleLarge)),
        ),
        Expanded(
          child: data.when(
            loading: () => const ListSkeleton(rows: 3),
            error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(savedSearchesProvider)),
            data: (d) => d.items.isEmpty
                ? const EmptyState(
                    icon: Icons.bookmark_border_rounded,
                    title: 'No saved searches yet',
                    body: 'Set some filters on Discover, then tap “Save search” to keep them here.',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: d.items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (c, i) => _SavedRow(s: d.items[i]),
                  ),
          ),
        ),
      ],
    );
  }
}

class _SavedRow extends ConsumerStatefulWidget {
  const _SavedRow({required this.s});
  final SavedSearch s;
  @override
  ConsumerState<_SavedRow> createState() => _SavedRowState();
}

class _SavedRowState extends ConsumerState<_SavedRow> {
  bool busy = false;
  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    return SectionCard(
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(s.name,
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
              ),
              if (s.newCount > 0) Pill('${s.newCount > 99 ? '99+' : s.newCount} new', tone: PillTone.love),
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert_rounded, color: C.ink3),
                onSelected: (v) async {
                  if (v == 'delete') {
                    if (!await confirm(context, title: 'Delete “${s.name}”?', yes: 'Delete', danger: true)) return;
                    if (!context.mounted) return;
                    await runGuarded(context, () async => Api.instance.delete('/searches/${s.id}'));
                  } else {
                    await runGuarded(context, () async => Api.instance.patch('/searches/${s.id}', {'notify': !s.notify}));
                  }
                  ref.invalidate(savedSearchesProvider);
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: 'notify', child: Text(s.notify ? 'Turn off alerts' : 'Turn on alerts')),
                  const PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: C.danger))),
                ],
              ),
            ],
          ),
          Text(describe(s.filters), style: const TextStyle(fontSize: 13, color: C.ink3)),
          if (s.locked.isNotEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text('Some paid filters are skipped on your plan.', style: TextStyle(fontSize: 12, color: C.gold)),
            ),
          const SizedBox(height: 8),
          AppButton(
            label: 'Show matches',
            dense: true,
            variant: ButtonVariant.soft,
            loading: busy,
            onPressed: () async {
              setState(() => busy = true);
              Filters f = s.filters;
              try {
                final r = await Api.instance.post('/searches/${s.id}/open');
                final opened = SavedSearch.fromJson(asMap(r)).filters;
                if (opened.isNotEmpty) f = opened;
              } catch (_) {
                // Opening still works with the filters we have.
              }
              ref.invalidate(savedSearchesProvider);
              if (context.mounted) Navigator.pop(context, f);
            },
          ),
        ],
      ),
    );
  }
}
