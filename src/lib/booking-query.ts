/** What the search box holds: a mobile number, a ticket number (PNR-seat) or a PNR. */
export function classifyQuery(raw: string): { kind: 'mobile' | 'ticket' | 'pnr'; value: string } | { error: string } | null {
  const v = raw.trim();
  if (!v) return null;
  const digits = v.replace(/\D/g, '');
  if (/^[+\d\s-]+$/.test(v) && digits.length >= 10) return { kind: 'mobile', value: digits.slice(-10) };
  if (/^[+\d\s-]+$/.test(v)) return { error: 'A mobile number has 10 digits' };
  if (/^[A-Za-z0-9]{4,12}-[A-Za-z0-9]{1,6}$/.test(v)) return { kind: 'ticket', value: v.toUpperCase() };
  if (/^[A-Za-z0-9]{4,12}$/.test(v)) return { kind: 'pnr', value: v.toUpperCase() };
  return { error: 'Enter a PNR, a 10-digit mobile number or a ticket number' };
}
