import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { appearanceApi } from '@/lib/api/platform';
import { useAuth } from '@/stores/auth';
import { isCustomer } from '@/lib/host';
import { DEFAULT_THEME, themeToCssVars } from './defaultTheme';
import type { Theme } from './types';
import { ThemeContext } from './theme-context';



// The customer storefront (people booking tickets) has its own look — the
// `.theme-customer` tokens in index.css; operator, platform and staff consoles
// keep the default black-and-white theme. On <body>, so dialogs and toasts
// rendered outside a page layout get it too.
if (isCustomer && typeof document !== 'undefined') document.body.classList.add('theme-customer');

function applyVars(theme: Theme): void {
  const vars = themeToCssVars(theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const role = useAuth((s) => s.user?.roles?.[0]);

  // Appearance is public — hydrate the theme for everyone (guest customer too),
  // per role when signed in.
  const { data } = useQuery({
    queryKey: ['appearance', role ?? 'default'],
    queryFn: () => appearanceApi.effective(role),
    staleTime: 5 * 60 * 1000,
  });

  const theme = data?.theme ?? DEFAULT_THEME;

  useEffect(() => {
    applyVars(theme);
  }, [theme]);

  const previewTheme = useCallback((t: Theme) => applyVars(t), []);
  const resetPreview = useCallback(() => applyVars(theme), [theme]);

  const value = useMemo(() => ({ theme, previewTheme, resetPreview }), [theme, previewTheme, resetPreview]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
