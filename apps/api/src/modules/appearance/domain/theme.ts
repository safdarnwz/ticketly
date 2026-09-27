import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Appearance / design-system tokens (Global Settings → Appearance)
 * ============================================================================
 *
 * The whole storefront + admin UI is driven by a set of DESIGN TOKENS stored
 * per operator (and optionally per role). An operator logs into the admin,
 * edits colours / fonts / radii / component styles, and every user — for that
 * role, across the whole platform (super-admin console and every operator's
 * own console alike) — instantly gets the new look, because the frontend
 * hydrates its CSS variables from these tokens at boot.
 *
 * This module is PURE: it owns the DEFAULT theme, validates a partial override,
 * deep-merges an override onto a base, and flattens a theme into the flat
 * `--yb-*` CSS-variable map the frontend consumes. No I/O — so the token schema,
 * the merge precedence (default ← role) and the CSS projection are all
 * exhaustively unit-testable.
 */

export type ThemeMode = 'light' | 'dark';

export interface ColorTokens {
  primary: string;
  primaryFg: string;
  secondary: string;
  secondaryFg: string;
  accent: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface RadiusTokens {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}
export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
}
export interface FontTokens {
  family: string;
  familyHeading: string;
  sizeBase: number;
  scale: number;
  weightNormal: number;
  weightMedium: number;
  weightBold: number;
}
export interface ComponentTokens {
  button: { height: number; paddingX: number; radius: number; fontWeight: number };
  input: { height: number; paddingX: number; radius: number; borderWidth: number };
  card: { radius: number; padding: number; shadow: keyof ShadowTokens };
  dropdown: { radius: number; shadow: keyof ShadowTokens };
  modal: { radius: number; shadow: keyof ShadowTokens };
}

export interface Theme {
  mode: ThemeMode;
  colors: ColorTokens;
  radius: RadiusTokens;
  shadow: ShadowTokens;
  font: FontTokens;
  spacingUnit: number; // base spacing in px
  components: ComponentTokens;
}

export type ThemePatch = DeepPartial<Theme>;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

// ── The default Ticketly theme (a clean, flat, minimal baseline) ───────────────
export const DEFAULT_THEME: Theme = {
  mode: 'light',
  colors: {
    // Ticketly "journey" palette — soft and friendly: a slate-navy primary, a
    // pink accent and a purple secondary (the From / To dots), sky blue for
    // prices, on a cool off-white background with white cards that float on
    // soft shadows instead of hairline borders.
    primary: '#3F5475',
    primaryFg: '#FFFFFF',
    secondary: '#7B4FB3',
    secondaryFg: '#FFFFFF',
    accent: '#F0628F',
    bg: '#F4F6FB',
    surface: '#FFFFFF',
    surfaceMuted: '#EAEEF5',
    border: '#E1E6EF',
    text: '#2F3E5C',
    textMuted: '#8390A8',
    success: '#1FA971',
    warning: '#E39A2D',
    danger: '#E5484D',
    info: '#2BA8F0',
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  shadow: {
    sm: '0 2px 8px rgba(47,62,92,0.06)',
    md: '0 8px 24px rgba(47,62,92,0.08)',
    lg: '0 20px 48px rgba(47,62,92,0.14)',
  },
  font: {
    family:
      "'Nunito Sans Variable', 'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    familyHeading:
      "'Nunito Sans Variable', 'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sizeBase: 15,
    scale: 1.2,
    weightNormal: 400,
    weightMedium: 600,
    weightBold: 700,
  },
  spacingUnit: 4,
  components: {
    button: { height: 44, paddingX: 20, radius: 12, fontWeight: 600 },
    input: { height: 44, paddingX: 14, radius: 12, borderWidth: 1 },
    card: { radius: 18, padding: 20, shadow: 'sm' },
    dropdown: { radius: 12, shadow: 'md' },
    modal: { radius: 24, shadow: 'lg' },
  },
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function assertHex(name: string, value: string): void {
  if (typeof value !== 'string' || !HEX.test(value)) {
    throw new DomainError(
      ErrorCode.COMMON_VALIDATION,
      `Colour '${name}' must be a hex value, got '${value}'`,
    );
  }
}
function assertRange(name: string, value: number, min: number, max: number): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    throw new DomainError(
      ErrorCode.COMMON_VALIDATION,
      `'${name}' must be a number in [${min}, ${max}], got ${value}`,
    );
  }
}

/** Validate a full theme (called after merge, before persist/serve). */
export function validateTheme(theme: Theme): void {
  if (theme.mode !== 'light' && theme.mode !== 'dark') {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, `mode must be 'light' or 'dark'`);
  }
  for (const [k, v] of Object.entries(theme.colors) as [string, string][])
    assertHex(`colors.${k}`, v);
  for (const [k, v] of Object.entries(theme.radius) as [string, number][])
    assertRange(`radius.${k}`, v, 0, 9999);
  assertRange('font.sizeBase', theme.font.sizeBase, 10, 24);
  assertRange('font.scale', theme.font.scale, 1, 2);
  assertRange('spacingUnit', theme.spacingUnit, 2, 16);
  assertRange('components.button.height', theme.components.button.height, 24, 72);
  assertRange('components.input.height', theme.components.input.height, 24, 72);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge a partial override onto a base theme (override wins, recursively). */
export function mergeTheme(base: Theme, patch: ThemePatch): Theme {
  return deepMerge(base as unknown as Record<string, unknown>, patch) as unknown as Theme;
}
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

/**
 * Resolve the effective theme for a role: DEFAULT ← platform-wide override ←
 * role-specific override. Each layer is a (possibly empty) partial.
 */
export function resolveTheme(platformPatch: ThemePatch = {}, rolePatch: ThemePatch = {}): Theme {
  const merged = mergeTheme(mergeTheme(DEFAULT_THEME, platformPatch), rolePatch);
  validateTheme(merged);
  return merged;
}

/** Flatten a theme into the `--yb-*` CSS-variable map the frontend consumes. */
export function tokensToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors) as [string, string][])
    vars[`--yb-color-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(theme.radius)) vars[`--yb-radius-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(theme.shadow) as [string, string][])
    vars[`--yb-shadow-${k}`] = v;
  vars['--yb-font-family'] = theme.font.family;
  vars['--yb-font-family-heading'] = theme.font.familyHeading;
  vars['--yb-font-size-base'] = `${theme.font.sizeBase}px`;
  vars['--yb-font-scale'] = `${theme.font.scale}`;
  vars['--yb-font-weight-normal'] = `${theme.font.weightNormal}`;
  vars['--yb-font-weight-medium'] = `${theme.font.weightMedium}`;
  vars['--yb-font-weight-bold'] = `${theme.font.weightBold}`;
  vars['--yb-spacing-unit'] = `${theme.spacingUnit}px`;
  vars['--yb-btn-height'] = `${theme.components.button.height}px`;
  vars['--yb-btn-padding-x'] = `${theme.components.button.paddingX}px`;
  vars['--yb-btn-radius'] = `${theme.components.button.radius}px`;
  vars['--yb-btn-font-weight'] = `${theme.components.button.fontWeight}`;
  vars['--yb-input-height'] = `${theme.components.input.height}px`;
  vars['--yb-input-padding-x'] = `${theme.components.input.paddingX}px`;
  vars['--yb-input-radius'] = `${theme.components.input.radius}px`;
  vars['--yb-input-border-width'] = `${theme.components.input.borderWidth}px`;
  vars['--yb-card-radius'] = `${theme.components.card.radius}px`;
  vars['--yb-card-padding'] = `${theme.components.card.padding}px`;
  vars['--yb-card-shadow'] = theme.shadow[theme.components.card.shadow];
  vars['--yb-dropdown-radius'] = `${theme.components.dropdown.radius}px`;
  vars['--yb-dropdown-shadow'] = theme.shadow[theme.components.dropdown.shadow];
  vars['--yb-modal-radius'] = `${theme.components.modal.radius}px`;
  vars['--yb-modal-shadow'] = theme.shadow[theme.components.modal.shadow];
  return vars;
}

/** Render the effective theme as a ready-to-inject `:root { … }` stylesheet. */
export function themeToCss(theme: Theme): string {
  const body = Object.entries(tokensToCssVars(theme))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root{\n${body}\n}`;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}
