import 'dart:async';

import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../core/api.dart';

/// Keeps content readable on tablets: centred, at most [S.maxContent] wide.
class ContentWidth extends StatelessWidget {
  const ContentWidth({super.key, required this.child, this.max = S.maxContent});
  final Widget child;
  final double max;
  @override
  Widget build(BuildContext context) => Center(
        child: ConstrainedBox(constraints: BoxConstraints(maxWidth: max), child: child),
      );
}

/// White rounded card with an optional title and hint.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.hint, required this.child, this.padding, this.danger = false});
  final String? title;
  final String? hint;
  final Widget child;
  final EdgeInsets? padding;
  final bool danger;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Container(
      width: double.infinity,
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: C.surface,
        borderRadius: BorderRadius.circular(S.radius),
        border: Border.all(color: danger ? C.danger.withValues(alpha: 0.35) : C.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null)
            Text(title!, style: t.titleMedium?.copyWith(color: danger ? C.danger : C.ink)),
          if (hint != null) ...[
            const SizedBox(height: 4),
            Text(hint!, style: t.bodyMedium?.copyWith(color: C.ink3, fontSize: 13.5)),
          ],
          if (title != null || hint != null) const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

/// Small uppercase heading above a group of cards.
class GroupLabel extends StatelessWidget {
  const GroupLabel(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: C.ink3),
        ),
      );
}

/// Filled pink button with a spinner while busy. Taps are ignored while busy,
/// so a double tap never sends twice.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.icon,
    this.variant = ButtonVariant.primary,
    this.expand = false,
    this.dense = false,
  });
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  final ButtonVariant variant;
  final bool expand;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final onTap = loading ? null : onPressed;
    final size = dense ? const Size(48, 38) : const Size(64, 48);
    final pad = dense ? const EdgeInsets.symmetric(horizontal: 14) : const EdgeInsets.symmetric(horizontal: 20);
    final textStyle = TextStyle(fontSize: dense ? 13.5 : 15, fontWeight: FontWeight.w600);
    final fg = switch (variant) {
      ButtonVariant.primary || ButtonVariant.danger || ButtonVariant.dark => Colors.white,
      ButtonVariant.secondary => C.ink,
      ButtonVariant.ghost => C.brand,
      ButtonVariant.soft => C.brand,
    };
    final child = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (loading)
          SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: fg))
        else if (icon != null)
          Icon(icon, size: dense ? 17 : 19),
        if (loading || icon != null) const SizedBox(width: 8),
        Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis)),
      ],
    );
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
    final Widget button = switch (variant) {
      ButtonVariant.primary => FilledButton(
          onPressed: onTap,
          style: FilledButton.styleFrom(minimumSize: size, padding: pad, textStyle: textStyle, shape: shape),
          child: child),
      ButtonVariant.dark => FilledButton(
          onPressed: onTap,
          style: FilledButton.styleFrom(
              backgroundColor: C.ink, minimumSize: size, padding: pad, textStyle: textStyle, shape: shape),
          child: child),
      ButtonVariant.danger => FilledButton(
          onPressed: onTap,
          style: FilledButton.styleFrom(
              backgroundColor: C.danger,
              disabledBackgroundColor: C.danger.withValues(alpha: 0.45),
              minimumSize: size,
              padding: pad,
              textStyle: textStyle,
              shape: shape),
          child: child),
      ButtonVariant.secondary => OutlinedButton(
          onPressed: onTap,
          style: OutlinedButton.styleFrom(minimumSize: size, padding: pad, textStyle: textStyle, shape: shape),
          child: child),
      ButtonVariant.ghost => TextButton(
          onPressed: onTap,
          style: TextButton.styleFrom(minimumSize: size, padding: pad, textStyle: textStyle, shape: shape),
          child: child),
      ButtonVariant.soft => FilledButton(
          onPressed: onTap,
          style: FilledButton.styleFrom(
              backgroundColor: C.brandSoft,
              foregroundColor: C.brand,
              minimumSize: size,
              padding: pad,
              textStyle: textStyle,
              shape: shape),
          child: child),
    };
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

enum ButtonVariant { primary, secondary, ghost, danger, soft, dark }

/// Soft grey block shown while something loads (no shimmer: nothing flickers).
class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.height = 16, this.width, this.radius = 10});
  final double height;
  final double? width;
  final double radius;
  @override
  Widget build(BuildContext context) => Container(
        height: height,
        width: width,
        decoration: BoxDecoration(color: C.sunk, borderRadius: BorderRadius.circular(radius)),
      );
}

class ListSkeleton extends StatelessWidget {
  const ListSkeleton({super.key, this.rows = 6, this.height = 76});
  final int rows;
  final double height;
  @override
  Widget build(BuildContext context) => ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(S.gutter),
        itemCount: rows,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, _) => Skeleton(height: height, radius: S.radius),
      );
}

/// Friendly "nothing here" block with an optional action.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.body, this.icon, this.action});
  final String title;
  final String? body;
  final IconData? icon;
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 36),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) Icon(icon, size: 44, color: C.brand),
          if (icon != null) const SizedBox(height: 14),
          Text(title, textAlign: TextAlign.center, style: t.titleMedium),
          if (body != null) ...[
            const SizedBox(height: 6),
            Text(body!, textAlign: TextAlign.center, style: t.bodyMedium),
          ],
          if (action != null) ...[const SizedBox(height: 18), action!],
        ],
      ),
    );
  }
}

/// Shown when loading failed: what happened and a way to try again.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, this.onRetry});
  final Object? error;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    final offline = error is ApiError && (error as ApiError).isNetwork;
    return EmptyState(
      icon: offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      title: offline ? 'No connection' : 'Could not load this',
      body: errorText(error),
      action: onRetry == null
          ? null
          : AppButton(label: 'Try again', icon: Icons.refresh_rounded, variant: ButtonVariant.secondary, onPressed: onRetry),
    );
  }
}

/// Coloured pill: "Online now", "Connected", "Awaiting reply".
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = PillTone.neutral, this.icon});
  final String text;
  final PillTone tone;
  final IconData? icon;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      PillTone.neutral => (C.sunk, C.ink2),
      PillTone.ok => (C.okSoft, C.ok),
      PillTone.love => (C.brandSoft, C.brand),
      PillTone.gold => (C.goldSoft, C.gold),
      PillTone.danger => (C.dangerSoft, C.danger),
      PillTone.dark => (C.ink, Colors.white),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)],
          Flexible(
            child: Text(text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
          ),
        ],
      ),
    );
  }
}

enum PillTone { neutral, ok, love, gold, danger, dark }

/// "87% match", coloured by strength.
class MatchChip extends StatelessWidget {
  const MatchChip(this.value, {super.key});
  final int value;
  @override
  Widget build(BuildContext context) =>
      Pill('$value% match', tone: value >= 70 ? PillTone.love : value >= 45 ? PillTone.gold : PillTone.neutral);
}

/// Count bubble on icons and tabs.
class CountBadge extends StatelessWidget {
  const CountBadge(this.count, {super.key, this.child});
  final int count;
  final Widget? child;
  @override
  Widget build(BuildContext context) {
    final label = count > 99 ? '99+' : '$count';
    if (child == null) {
      return count <= 0
          ? const SizedBox.shrink()
          : Container(
              constraints: const BoxConstraints(minWidth: 20),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: C.coral, borderRadius: BorderRadius.circular(999)),
              child: Text(label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700)),
            );
    }
    return Badge(
      isLabelVisible: count > 0,
      backgroundColor: C.coral,
      label: Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700)),
      child: child,
    );
  }
}

/// A row of selectable chips. Single choice unless [multiple].
class ChoiceChips<T> extends StatelessWidget {
  const ChoiceChips({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
    this.multiple = false,
    this.enabled = true,
  });
  final List<(T, String)> options;
  final Set<T> selected;
  final ValueChanged<Set<T>> onChanged;
  final bool multiple;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final (value, label) in options)
          FilterChip(
            label: Text(label),
            selected: selected.contains(value),
            showCheckmark: false,
            onSelected: !enabled
                ? null
                : (on) {
                    if (multiple) {
                      final next = {...selected};
                      on ? next.add(value) : next.remove(value);
                      onChanged(next);
                    } else {
                      // Tapping the chosen chip again clears a single choice.
                      onChanged(on ? {value} : <T>{});
                    }
                  },
            labelStyle: TextStyle(
              fontSize: 13.5,
              fontWeight: selected.contains(value) ? FontWeight.w600 : FontWeight.w500,
              color: selected.contains(value) ? Colors.white : C.ink2,
            ),
            selectedColor: C.ink,
            backgroundColor: C.surface,
            side: BorderSide(color: selected.contains(value) ? C.ink : C.lineStrong),
            materialTapTargetSize: MaterialTapTargetSize.padded,
          ),
      ],
    );
  }
}

/// Setting with a compact switch. [locked] shows a "Paid plans" tag instead.
class ToggleRow extends StatelessWidget {
  const ToggleRow({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.description,
    this.enabled = true,
    this.locked,
  });
  final String label;
  final String? description;
  final bool value;
  final bool enabled;
  final Widget? locked;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final canTap = enabled && locked == null;
    return InkWell(
      onTap: canTap ? () => onChanged(!value) : null,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: const TextStyle(fontSize: 14.5, color: C.ink, fontWeight: FontWeight.w500)),
                  if (description != null) ...[
                    const SizedBox(height: 2),
                    Text(description!, style: const TextStyle(fontSize: 12.5, color: C.ink3, height: 1.35)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 12),
            locked ??
                Transform.scale(
                  scale: 0.8,
                  alignment: Alignment.centerRight,
                  child: Switch(value: value, onChanged: canTap ? onChanged : null),
                ),
          ],
        ),
      ),
    );
  }
}

/// Short message at the bottom of the screen; [action] adds a button.
void toast(BuildContext context, String message, {bool error = false, String? actionLabel, VoidCallback? action}) {
  final m = ScaffoldMessenger.maybeOf(context);
  if (m == null) return;
  m.hideCurrentSnackBar();
  m.showSnackBar(SnackBar(
    content: Row(
      children: [
        if (error) const Padding(padding: EdgeInsets.only(right: 10), child: Icon(Icons.error_outline, color: Color(0xFFFFB3B3), size: 20)),
        Expanded(child: Text(message)),
      ],
    ),
    duration: Duration(milliseconds: error ? 4500 : 3000),
    action: action == null ? null : SnackBarAction(label: actionLabel ?? 'Open', onPressed: action),
  ));
}

/// Yes / no question. Resolves to false when dismissed.
Future<bool> confirm(
  BuildContext context, {
  required String title,
  String? body,
  String yes = 'Yes',
  String no = 'Cancel',
  bool danger = false,
}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title, style: Theme.of(c).textTheme.titleLarge),
      content: body == null ? null : Text(body, style: Theme.of(c).textTheme.bodyLarge?.copyWith(color: C.ink2)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(no, style: const TextStyle(color: C.ink2))),
        TextButton(
          onPressed: () => Navigator.pop(c, true),
          child: Text(yes, style: TextStyle(color: danger ? C.danger : C.brand)),
        ),
      ],
    ),
  );
  return r ?? false;
}

/// Bottom sheet that scrolls, stays above the keyboard and respects the
/// phone's safe areas.
Future<T?> showAppSheet<T>(BuildContext context, {required Widget Function(BuildContext) builder, bool full = false}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    constraints: const BoxConstraints(maxWidth: 640),
    builder: (c) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(c).bottom),
      child: full
          ? SizedBox(height: MediaQuery.sizeOf(c).height * 0.88, child: builder(c))
          : ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(c).height * 0.88),
              child: builder(c),
            ),
    ),
  );
}

/// Pick one value from a long list (city, state, height…) with search.
Future<T?> pickOne<T>(
  BuildContext context, {
  required String title,
  required List<(T, String)> options,
  T? current,
  bool searchable = false,
}) {
  return showAppSheet<T>(
    context,
    full: options.length > 12,
    builder: (c) => _PickList<T>(title: title, options: options, current: current, searchable: searchable),
  );
}

class _PickList<T> extends StatefulWidget {
  const _PickList({required this.title, required this.options, this.current, required this.searchable});
  final String title;
  final List<(T, String)> options;
  final T? current;
  final bool searchable;
  @override
  State<_PickList<T>> createState() => _PickListState<T>();
}

class _PickListState<T> extends State<_PickList<T>> {
  String q = '';
  @override
  Widget build(BuildContext context) {
    final shown = widget.options.where((o) => o.$2.toLowerCase().contains(q.toLowerCase())).toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
          child: Align(alignment: Alignment.centerLeft, child: Text(widget.title, style: Theme.of(context).textTheme.titleLarge)),
        ),
        if (widget.searchable || widget.options.length > 12)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              decoration: const InputDecoration(hintText: 'Search', prefixIcon: Icon(Icons.search)),
              onChanged: (v) => setState(() => q = v.trim()),
            ),
          ),
        Flexible(
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: shown.length,
            itemBuilder: (c, i) {
              final (value, label) = shown[i];
              final on = value == widget.current;
              return ListTile(
                title: Text(label, style: TextStyle(fontWeight: on ? FontWeight.w600 : FontWeight.w400)),
                trailing: on ? const Icon(Icons.check_rounded, color: C.brand) : null,
                onTap: () => Navigator.pop(c, value),
              );
            },
          ),
        ),
        SizedBox(height: MediaQuery.paddingOf(context).bottom + 8),
      ],
    );
  }
}

/// A form row that opens a picker: label on top, value in a field-like box.
class PickerField extends StatelessWidget {
  const PickerField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.hint,
    this.placeholder = 'Select',
    this.enabled = true,
  });
  final String label;
  final String? value;
  final String? hint;
  final String placeholder;
  final VoidCallback onTap;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FieldLabel(label),
        InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: InputDecorator(
            decoration: InputDecoration(
              enabled: enabled,
              suffixIcon: const Icon(Icons.expand_more_rounded),
              fillColor: enabled ? C.surface : C.soft,
            ),
            child: Text(
              value ?? placeholder,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 15, color: value == null ? C.ink3 : (enabled ? C.ink : C.ink3)),
            ),
          ),
        ),
        if (hint != null) FieldHint(hint!),
      ],
    );
  }
}

class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, this.optional = false});
  final String text;
  final bool optional;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6, left: 2),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: text),
          if (optional) const TextSpan(text: '  optional', style: TextStyle(color: C.ink3, fontWeight: FontWeight.w400)),
        ])),
      );
}

class FieldHint extends StatelessWidget {
  const FieldHint(this.text, {super.key, this.error = false});
  final String text;
  final bool error;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6, left: 2),
        child: Text(text, style: TextStyle(fontSize: 12.5, color: error ? C.danger : C.ink3, height: 1.35)),
      );
}

/// Gold box: "this is part of paid plans", with a link to plans.
class LockedNote extends StatelessWidget {
  const LockedNote(this.text, {super.key, this.onSeePlans});
  final String text;
  final VoidCallback? onSeePlans;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: C.goldSoft, borderRadius: BorderRadius.circular(12)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.lock_rounded, size: 17, color: C.gold)),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(text, style: const TextStyle(fontSize: 13.5, color: C.ink, height: 1.4)),
                  if (onSeePlans != null)
                    GestureDetector(
                      onTap: onSeePlans,
                      child: const Padding(
                        padding: EdgeInsets.only(top: 6),
                        child: Text('See plans',
                            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: C.brand)),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
}

/// Coloured notice box.
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = PillTone.gold, this.icon, this.title, this.action});
  final String text;
  final String? title;
  final PillTone tone;
  final IconData? icon;
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      PillTone.ok => (C.okSoft, C.ok),
      PillTone.danger => (C.dangerSoft, C.danger),
      PillTone.love => (C.brandSoft, C.brand),
      PillTone.neutral => (C.sunk, C.ink2),
      _ => (C.warnSoft, C.gold),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon ?? Icons.info_outline_rounded, size: 19, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text(title!, style: const TextStyle(fontWeight: FontWeight.w600, color: C.ink, fontSize: 14.5)),
                  ),
                Text(text, style: const TextStyle(fontSize: 13.5, color: C.ink, height: 1.4)),
                if (action != null) Padding(padding: const EdgeInsets.only(top: 8), child: action!),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Runs [task] once; ignores taps while it runs. Shows errors as a toast.
/// Returns true when it finished without error.
Future<bool> runGuarded(BuildContext context, Future<void> Function() task, {bool quietUpgrade = true}) async {
  try {
    await task();
    return true;
  } catch (e) {
    // Plan limits open the upgrade sheet on their own.
    if (quietUpgrade && e is ApiError && e.isUpgrade) return false;
    if (context.mounted) toast(context, errorText(e), error: true);
    return false;
  }
}

/// Debounces quick repeated calls (typing indicator, search box).
class Debouncer {
  Debouncer(this.delay);
  final Duration delay;
  Timer? _t;
  void call(void Function() f) {
    _t?.cancel();
    _t = Timer(delay, f);
  }

  void dispose() => _t?.cancel();
}
