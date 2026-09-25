import { createContext, useContext } from 'react';

import { DEFAULT_THEME } from './defaultTheme';
import type { Theme } from './types';

export interface ThemeContextValue {
  theme: Theme;
  /** Apply an arbitrary theme's variables to :root — used for live preview. */
  previewTheme: (theme: Theme) => void;
  /** Restore the persisted effective theme. */
  resetPreview: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  previewTheme: () => {},
  resetPreview: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
