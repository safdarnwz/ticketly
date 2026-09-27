import type { Config } from 'tailwindcss';

/**
 * Tailwind is wired to the backend-driven design tokens: every colour, radius,
 * shadow and font maps to a `--yb-*` CSS variable that ThemeProvider hydrates
 * from GET /v1/appearance. Changing the theme in the admin re-skins the whole UI
 * with zero rebuild — Tailwind utilities like `bg-primary` or `rounded-card`
 * resolve to the live variable.
 */
/** A theme colour that also takes Tailwind's opacity modifier (`bg-primary/10`). */
const c = (v: string) => `color-mix(in srgb, var(${v}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: c('--yb-color-primary'), fg: c('--yb-color-primary-fg') },
        secondary: { DEFAULT: c('--yb-color-secondary'), fg: c('--yb-color-secondary-fg') },
        accent: c('--yb-color-accent'),
        bg: c('--yb-color-bg'),
        surface: c('--yb-color-surface'),
        'surface-muted': c('--yb-color-surface-muted'),
        border: c('--yb-color-border'),
        text: c('--yb-color-text'),
        'text-muted': c('--yb-color-text-muted'),
        success: c('--yb-color-success'),
        warning: c('--yb-color-warning'),
        danger: c('--yb-color-danger'),
        info: c('--yb-color-info'),
      },
      borderRadius: {
        sm: 'var(--yb-radius-sm)',
        md: 'var(--yb-radius-md)',
        lg: 'var(--yb-radius-lg)',
        xl: 'var(--yb-radius-xl)',
        pill: 'var(--yb-radius-pill)',
        card: 'var(--yb-card-radius)',
        btn: 'var(--yb-btn-radius)',
        input: 'var(--yb-input-radius)',
      },
      boxShadow: {
        sm: 'var(--yb-shadow-sm)',
        md: 'var(--yb-shadow-md)',
        lg: 'var(--yb-shadow-lg)',
        card: 'var(--yb-card-shadow)',
        dropdown: 'var(--yb-dropdown-shadow)',
      },
      fontFamily: {
        sans: 'var(--yb-font-family)',
        heading: 'var(--yb-font-family-heading)',
      },
      spacing: {
        'btn-x': 'var(--yb-btn-padding-x)',
        'input-x': 'var(--yb-input-padding-x)',
        card: 'var(--yb-card-padding)',
      },
      height: {
        btn: 'var(--yb-btn-height)',
        input: 'var(--yb-input-height)',
      },
    },
  },
  plugins: [],
} satisfies Config;
