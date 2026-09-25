/**
 * The GST Council's official numeric state/UT codes (the first two digits
 * of every Indian GSTIN) mapped to the ISO-style 2-letter codes this
 * codebase already stores on `states.code`. This is a fixed, rarely-
 * changing government list — states are not renumbered — so a small
 * hardcoded table is the right call rather than a database table that
 * would need its own seed/migration for something that essentially never
 * changes.
 *
 * Used ONLY to determine interState for GST (CGST+SGST vs IGST): the
 * correct rule per IGST Act s.12(9)/13(9) for passenger transport is the
 * OPERATOR'S OWN registered state (from their GSTIN) vs the trip's place
 * of supply (the embarkation/origin state) — NOT whether the trip's
 * origin and destination states differ from each other, which is a
 * different question with no bearing on GST liability.
 */
export const GST_STATE_CODE_TO_ISO: Readonly<Record<string, string>> = {
  '01': 'JK',
  '02': 'HP',
  '03': 'PB',
  '04': 'CH',
  '05': 'UT',
  '06': 'HR',
  '07': 'DL',
  '08': 'RJ',
  '09': 'UP',
  '10': 'BR',
  '11': 'SK',
  '12': 'AR',
  '13': 'NL',
  '14': 'MN',
  '15': 'MZ',
  '16': 'TR',
  '17': 'ML',
  '18': 'AS',
  '19': 'WB',
  '20': 'JH',
  '21': 'OR',
  '22': 'CG',
  '23': 'MP',
  '24': 'GJ',
  '26': 'DN',
  '27': 'MH',
  '28': 'AP',
  '29': 'KA',
  '30': 'GA',
  '31': 'LD',
  '32': 'KL',
  '33': 'TN',
  '34': 'PY',
  '35': 'AN',
  '36': 'TG',
  '37': 'AD',
  '38': 'LA',
  '97': 'OT',
};

/** Extracts the ISO state-code from a GSTIN's first two digits, or null if the GSTIN is missing/malformed. */
export function stateFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return GST_STATE_CODE_TO_ISO[gstin.slice(0, 2)] ?? null;
}

/** The GST numeric code ("07") of an ISO-style state code ("DL"), or null. */
export function gstCodeOfState(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return Object.entries(GST_STATE_CODE_TO_ISO).find(([, v]) => v === iso)?.[0] ?? null;
}
