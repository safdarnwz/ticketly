import { describe, it, expect } from 'vitest';

import {
  DEFAULT_THEME,
  validateTheme,
  mergeTheme,
  resolveTheme,
  tokensToCssVars,
  themeToCss,
} from '../domain/theme';

describe('validateTheme', () => {
  it('happy: the default theme is valid', () => {
    expect(() => validateTheme(DEFAULT_THEME)).not.toThrow();
  });
  it('negative: a bad hex colour is rejected', () => {
    const bad = mergeTheme(DEFAULT_THEME, { colors: { primary: 'green' } });
    expect(() => validateTheme(bad)).toThrow();
  });
  it('negative: an out-of-range font size is rejected', () => {
    const bad = mergeTheme(DEFAULT_THEME, { font: { sizeBase: 40 } });
    expect(() => validateTheme(bad)).toThrow();
  });
});

describe('mergeTheme', () => {
  it('happy: deep-merges only the overridden leaves', () => {
    const merged = mergeTheme(DEFAULT_THEME, {
      colors: { primary: '#123456' },
      components: { button: { height: 48 } },
    });
    expect(merged.colors.primary).toBe('#123456');
    expect(merged.colors.bg).toBe(DEFAULT_THEME.colors.bg); // untouched
    expect(merged.components.button.height).toBe(48);
    expect(merged.components.button.paddingX).toBe(DEFAULT_THEME.components.button.paddingX); // untouched
  });
  it('edge: an empty patch returns an equivalent theme', () => {
    expect(mergeTheme(DEFAULT_THEME, {})).toEqual(DEFAULT_THEME);
  });
});

describe('resolveTheme (default ← tenant ← role)', () => {
  it('happy: role override beats tenant override beats default', () => {
    const t = resolveTheme({ colors: { primary: '#111111' } }, { colors: { primary: '#222222' } });
    expect(t.colors.primary).toBe('#222222');
  });
  it('positive: tenant applies where role is silent', () => {
    const t = resolveTheme({ colors: { accent: '#ABCDEF' } }, { colors: { primary: '#222222' } });
    expect(t.colors.accent).toBe('#ABCDEF');
    expect(t.colors.primary).toBe('#222222');
  });
  it('negative: an invalid merged result throws', () => {
    expect(() => resolveTheme({ colors: { danger: 'notacolour' } })).toThrow();
  });
});

describe('css projection', () => {
  it('happy: flattens tokens into --yb-* variables (kebab-cased)', () => {
    const vars = tokensToCssVars(DEFAULT_THEME);
    expect(vars['--yb-color-primary']).toBe('#000000');
    expect(vars['--yb-color-accent']).toBe('#CB2957');
    expect(vars['--yb-color-primary-fg']).toBe('#FFFFFF'); // camelCase key → kebab var
    expect(vars['--yb-radius-md']).toBe('8px');
    expect(vars['--yb-btn-height']).toBe('44px');
    expect(vars['--yb-card-shadow']).toBe(DEFAULT_THEME.shadow.sm); // resolved reference
  });
  it('positive: themeToCss wraps them in a :root block', () => {
    const css = themeToCss(DEFAULT_THEME);
    expect(css).toContain(':root{');
    expect(css).toContain('--yb-color-primary: #000000;');
    expect(css).toContain('}');
  });
});
