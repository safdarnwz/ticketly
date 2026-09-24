/**
 * A clean initials logo for a newly approved operator, so every operator has
 * {slug}/branding/logo.svg from day one (replaceable from their console).
 * Pure + deterministic: same company name → same colour. Output contains no
 * script/links, so it passes the same SVG safety check as uploaded logos.
 */
const PALETTE = ['#0F766E', '#1D4ED8', '#7C3AED', '#B45309', '#BE123C', '#15803D', '#0369A1', '#9333EA'];

export function initialsOf(name: string): string {
  const words = name.replace(/\b(pvt|private|ltd|limited|llp|travels?|tours?|and|&)\b\.?/gi, ' ').trim().split(/\s+/).filter(Boolean);
  const src = words.length ? words : name.trim().split(/\s+/);
  const letters = (src.length >= 2 ? src[0][0] + src[1][0] : (src[0] ?? 'OP').slice(0, 2)).toUpperCase();
  return letters.replace(/[^A-Z0-9]/g, '') || 'OP';
}

export function defaultLogoSvg(companyName: string): string {
  let h = 0;
  for (const c of companyName) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = PALETTE[h % PALETTE.length];
  const initials = initialsOf(companyName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${initials}">
  <rect width="256" height="256" rx="48" fill="${color}"/>
  <text x="128" y="128" dy="0.35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="104" font-weight="700" fill="#FFFFFF">${initials}</text>
</svg>
`;
}
