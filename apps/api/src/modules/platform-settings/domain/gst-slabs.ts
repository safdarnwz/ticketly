/**
 * Global GST tax slabs (#33).
 *
 * A named catalogue of the rates the platform works with (e.g. AC stage
 * carriage 5%, non-AC 0%, platform services 18%). Rates are government-set,
 * so only the platform admin edits them. Codes are unique; rates 0–28 are
 * the only rates Indian GST uses.
 */
export interface GstSlab {
  code: string;
  label: string;
  ratePct: number;
  appliesTo: string;
}

export const ALLOWED_GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28] as const;

export const DEFAULT_GST_SLABS: GstSlab[] = [
  { code: 'transport_ac', label: 'Passenger transport — AC', ratePct: 5, appliesTo: 'ticket' },
  { code: 'transport_non_ac', label: 'Passenger transport — non-AC', ratePct: 0, appliesTo: 'ticket' },
  { code: 'platform_services', label: 'Platform / commission services', ratePct: 18, appliesTo: 'platform_fee' },
];

export function gstSlabErrors(slabs: GstSlab[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of slabs) {
    if (seen.has(s.code)) errors.push(`duplicate slab code '${s.code}'`);
    seen.add(s.code);
    if (!(ALLOWED_GST_RATES as readonly number[]).includes(s.ratePct)) errors.push(`'${s.code}': ${s.ratePct}% is not a GST rate`);
  }
  return errors;
}
