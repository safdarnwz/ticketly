/**
 * The customer look for documents made outside the browser — the e-ticket page
 * and email, the GST invoice (HTML and PDF), notification emails. The same
 * colours as the web storefront's customer theme, so a printed ticket looks
 * like the app the passenger booked on. (Operator and platform consoles keep
 * the default black-and-white theme of the appearance module.)
 */
export const BRAND_PALETTE = {
  primary: '#3F5475',
  primaryFg: '#FFFFFF',
  secondary: '#7B4FB3',
  accent: '#F0628F',
  info: '#2BA8F0',
  bg: '#F4F6FB',
  surface: '#FFFFFF',
  surfaceMuted: '#EAEEF5',
  text: '#2F3E5C',
  textMuted: '#8390A8',
  border: '#E1E6EF',
  dashed: '#D5DCE8',
} as const;
