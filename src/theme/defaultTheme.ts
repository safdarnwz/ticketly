import type { Theme } from './types';

/** Mirror of the backend DEFAULT_THEME — used until GET /v1/appearance resolves. */
export const DEFAULT_THEME: Theme = {
  mode: 'light',
  colors: {
    primary: '#000000', primaryFg: '#FFFFFF',
    secondary: '#000000', secondaryFg: '#FFFFFF',
    accent: '#CB2957',
    bg: '#FFFFFF', surface: '#FFFFFF', surfaceMuted: '#EEEEEE',
    border: '#DDDDDD',
    text: '#000000', textMuted: '#6E6E6E',
    success: '#16A34A', warning: '#D97706', danger: '#DC2626', info: '#3F72AF',
  },
  radius: { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.04)',
    md: '0 1px 3px rgba(0,0,0,0.06)',
    lg: '0 4px 16px rgba(0,0,0,0.08)',
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    familyHeading: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sizeBase: 15, scale: 1.2,
    weightNormal: 400, weightMedium: 500, weightBold: 600,
  },
  spacingUnit: 4,
  components: {
    button: { height: 44, paddingX: 18, radius: 8, fontWeight: 500 },
    input: { height: 44, paddingX: 14, radius: 8, borderWidth: 1 },
    card: { radius: 12, padding: 20, shadow: 'sm' },
    dropdown: { radius: 8, shadow: 'md' },
    modal: { radius: 16, shadow: 'lg' },
  },
};

/** Flatten a theme into the `--yb-*` CSS variables the stylesheet consumes. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(theme.colors)) v[`--yb-color-${kebab(k)}`] = val;
  for (const [k, val] of Object.entries(theme.radius)) v[`--yb-radius-${k}`] = `${val}px`;
  for (const [k, val] of Object.entries(theme.shadow)) v[`--yb-shadow-${k}`] = val;
  v['--yb-font-family'] = theme.font.family;
  v['--yb-font-family-heading'] = theme.font.familyHeading;
  v['--yb-font-size-base'] = `${theme.font.sizeBase}px`;
  v['--yb-font-scale'] = `${theme.font.scale}`;
  v['--yb-font-weight-normal'] = `${theme.font.weightNormal}`;
  v['--yb-font-weight-medium'] = `${theme.font.weightMedium}`;
  v['--yb-font-weight-bold'] = `${theme.font.weightBold}`;
  v['--yb-spacing-unit'] = `${theme.spacingUnit}px`;
  v['--yb-btn-height'] = `${theme.components.button.height}px`;
  v['--yb-btn-padding-x'] = `${theme.components.button.paddingX}px`;
  v['--yb-btn-radius'] = `${theme.components.button.radius}px`;
  v['--yb-btn-font-weight'] = `${theme.components.button.fontWeight}`;
  v['--yb-input-height'] = `${theme.components.input.height}px`;
  v['--yb-input-padding-x'] = `${theme.components.input.paddingX}px`;
  v['--yb-input-radius'] = `${theme.components.input.radius}px`;
  v['--yb-input-border-width'] = `${theme.components.input.borderWidth}px`;
  v['--yb-card-radius'] = `${theme.components.card.radius}px`;
  v['--yb-card-padding'] = `${theme.components.card.padding}px`;
  v['--yb-card-shadow'] = theme.shadow[theme.components.card.shadow];
  v['--yb-dropdown-radius'] = `${theme.components.dropdown.radius}px`;
  v['--yb-dropdown-shadow'] = theme.shadow[theme.components.dropdown.shadow];
  v['--yb-modal-radius'] = `${theme.components.modal.radius}px`;
  v['--yb-modal-shadow'] = theme.shadow[theme.components.modal.shadow];
  return v;
}
