// Mirror of the backend appearance token schema (apps/api/.../domain/theme.ts).
export type ThemeMode = 'light' | 'dark';

export interface ColorTokens {
  primary: string; primaryFg: string;
  secondary: string; secondaryFg: string;
  accent: string;
  bg: string; surface: string; surfaceMuted: string;
  border: string;
  text: string; textMuted: string;
  success: string; warning: string; danger: string; info: string;
}
export interface RadiusTokens { sm: number; md: number; lg: number; xl: number; pill: number }
export interface ShadowTokens { sm: string; md: string; lg: string }
export interface FontTokens {
  family: string; familyHeading: string;
  sizeBase: number; scale: number;
  weightNormal: number; weightMedium: number; weightBold: number;
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
  spacingUnit: number;
  components: ComponentTokens;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ThemePatch = DeepPartial<Theme>;
