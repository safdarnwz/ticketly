import type { Config } from 'tailwindcss';

/**
 * Tailwind is wired to the backend-driven design tokens: every colour, radius,
 * shadow and font maps to a `--yb-*` CSS variable that ThemeProvider hydrates
 * from GET /v1/appearance. Changing the theme in the admin re-skins the whole UI
 * with zero rebuild — Tailwind utilities like `bg-primary` or `rounded-card`
 * resolve to the live variable.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'var(--yb-color-primary)', fg: 'var(--yb-color-primary-fg)' },
        secondary: { DEFAULT: 'var(--yb-color-secondary)', fg: 'var(--yb-color-secondary-fg)' },
        accent: 'var(--yb-color-accent)',
        bg: 'var(--yb-color-bg)',
        surface: 'var(--yb-color-surface)',
        'surface-muted': 'var(--yb-color-surface-muted)',
        border: 'var(--yb-color-border)',
        text: 'var(--yb-color-text)',
        'text-muted': 'var(--yb-color-text-muted)',
        success: 'var(--yb-color-success)',
        warning: 'var(--yb-color-warning)',
        danger: 'var(--yb-color-danger)',
        info: 'var(--yb-color-info)',
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
