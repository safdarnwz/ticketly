import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { appearanceApi } from '@/lib/api/platform';
import { useAuth } from '@/stores/auth';
import { DEFAULT_THEME, themeToCssVars } from './defaultTheme';
import type { Theme } from './types';
import { ThemeContext } from './theme-context';



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
