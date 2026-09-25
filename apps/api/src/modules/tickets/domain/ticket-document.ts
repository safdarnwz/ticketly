/**
 * The e-ticket as a document: one view of a confirmed booking, rendered as
 * the printable page (QR as inline SVG) and as the email (QR as an inline
 * image attachment — mail clients run no scripts and most block data: URIs).
 * Pure: the service gathers the data, these functions only lay it out, so the
 * page and the email can never disagree.
 */

export interface TicketView {
  operatorName: string;
  operatorGstin: string | null;
  operatorPhone: string | null;
  logoDataUri: string | null;
  pnr: string;
  seatType: string | null;
  from: { name: string; landmark: string | null; at: Date | null };
  to: { name: string; landmark: string | null; at: Date | null };
  passengers: { seat: string; name: string; age: number | null; gender: string | null }[];
  fareMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  trackingUrl: string;
  /** The booking-level QR content (signed). */
  qrToken: string;
  timeZone: string;
  /** The operator's own confirmation wording (its email template), if any. */
  intro?: string | null;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function formatMoneyMinor(minor: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SEAT_TYPE: Record<string, string> = {
  seater: 'Seater',
  semi_sleeper: 'Semi-sleeper',
  sleeper: 'Sleeper',
  upper_sleeper: 'Upper sleeper',
  lower_sleeper: 'Lower sleeper',
};

function when(d: Date | null, tz: string): { date: string; time: string } | null {
  if (!d) return null;
  return {
    date: d.toLocaleDateString('en-IN', {
      timeZone: tz,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: d.toLocaleTimeString('en-IN', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  };
}

function genderLetter(g: string | null): string {
  return g ? g[0].toUpperCase() : '';
}

export function ticketSubject(v: TicketView): string {
  const d = when(v.from.at, v.timeZone);
  return `e-Ticket — PNR ${v.pnr} · ${v.from.name} → ${v.to.name}${d ? ` · ${d.date}` : ''}`;
}

/** Plain-text alternative (also what the delivery log keeps). */
export function ticketText(v: TicketView): string {
  const f = when(v.from.at, v.timeZone);
  const t = when(v.to.at, v.timeZone);
  return [
    v.intro ?? `Your booking with ${v.operatorName} is confirmed.`,
    '',
    `PNR: ${v.pnr}`,
    `Boarding: ${v.from.name}${f ? `, ${f.date} ${f.time}` : ''}`,
    `Dropping: ${v.to.name}${t ? `, ${t.date} ${t.time}` : ''}`,
    `Passengers: ${v.passengers.map((p) => `${p.name} (seat ${p.seat})`).join(', ')}`,
    `Total paid: ${formatMoneyMinor(v.totalMinor, v.currency)}`,
    '',
    `Track your bus: ${v.trackingUrl}`,
    'Show the QR code on this ticket to the conductor when boarding.',
  ].join('\n');
}

/**
 * The ticket body, shared by the page and the email. Table layout with inline
 * styles so it survives mail clients. `qr` is the HTML for the QR image.
 */
function ticketBody(v: TicketView, qr: string): string {
  const e = escapeHtml;
  const f = when(v.from.at, v.timeZone);
  const t = when(v.to.at, v.timeZone);
  const money = (m: number) => e(formatMoneyMinor(m, v.currency));
  const muted = 'color:#6b7280;font-size:12px';
  const pax = v.passengers
    .map(
      (p) => `<tr>
        <td style="padding:8px 0;border-top:1px dashed #d1d5db">${e(p.name)}${p.age ? `, ${p.age}` : ''} ${e(genderLetter(p.gender))}</td>
        <td style="padding:8px 0;border-top:1px dashed #d1d5db;text-align:right;font-weight:600">Seat ${e(p.seat)}</td>
      </tr>`,
    )
    .join('');
  const stop = (label: string, s: TicketView['from'], w: typeof f, align: 'left' | 'right') => `
    <td style="vertical-align:top;text-align:${align};width:50%">
      <div style="${muted}">${label}</div>
      <div style="font-size:16px;font-weight:700;margin-top:2px">${e(s.name)}</div>
      ${s.landmark ? `<div style="${muted}">${e(s.landmark)}</div>` : ''}
      ${w ? `<div style="font-size:14px;font-weight:600;margin-top:4px">${e(w.time)}</div><div style="${muted}">${e(w.date)}</div>` : ''}
    </td>`;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:#111827;border-collapse:separate">
  <tr><td style="padding:18px 20px;border-bottom:1px solid #e5e7eb">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="vertical-align:top">
        ${v.logoDataUri ? `<img src="${e(v.logoDataUri)}" alt="" style="max-height:40px;max-width:120px;margin-bottom:6px">` : ''}
        <div style="font-size:18px;font-weight:700">${e(v.operatorName)}</div>
        ${v.operatorGstin ? `<div style="${muted}">GSTIN ${e(v.operatorGstin)}</div>` : ''}
        <div style="margin-top:8px;font-size:13px">PNR <b style="font-size:15px;letter-spacing:.5px">${e(v.pnr)}</b></div>
        <div style="${muted}">${v.passengers.length} seat${v.passengers.length === 1 ? '' : 's'}${v.seatType ? ` · ${e(SEAT_TYPE[v.seatType] ?? v.seatType)}` : ''}</div>
      </td>
      <td style="vertical-align:top;text-align:right;width:120px">${qr}<div style="${muted};text-align:center">Show at boarding</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 20px;border-bottom:1px solid #e5e7eb">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      ${stop('Boarding point', v.from, f, 'left')}
      ${stop('Dropping point', v.to, t, 'right')}
    </tr></table>
  </td></tr>
  <tr><td style="padding:8px 20px 12px;border-bottom:1px solid #e5e7eb">
    <div style="${muted};margin:6px 0">Passengers</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px">${pax}</table>
  </td></tr>
  <tr><td style="padding:14px 20px;border-bottom:1px solid #e5e7eb;font-size:14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="padding:2px 0">Fare</td><td style="text-align:right">${money(v.fareMinor)}</td></tr>
      <tr><td style="padding:2px 0">GST</td><td style="text-align:right">${money(v.taxMinor)}</td></tr>
      <tr><td style="padding:6px 0 0;border-top:1px solid #e5e7eb;font-weight:700">Total paid</td><td style="padding:6px 0 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:700">${money(v.totalMinor)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:14px 20px;font-size:13px">
    <a href="${e(v.trackingUrl)}" style="color:#2563eb">Track your bus live</a>
    ${v.operatorPhone ? `<span style="${muted}"> · Operator helpline ${e(v.operatorPhone)}</span>` : ''}
    <div style="${muted};margin-top:8px">Reach the boarding point 15 minutes before departure with a photo ID. ${e(v.operatorName)} is the transport provider for this journey. Your GST tax invoice is sent in a separate email.</div>
  </td></tr>
</table>`;
}

/** The printable page. `qrSvg` is the QR as an SVG string (made server-side, no scripts). */
export function renderTicketPage(v: TicketView, qrSvg: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(v.operatorName)} e-Ticket ${escapeHtml(v.pnr)}</title>
<style>body{margin:0;padding:24px;background:#fff}@media print{body{padding:0}}</style>
</head><body>${ticketBody(v, `<div style="width:110px;height:110px;display:inline-block" aria-label="Boarding QR for PNR ${escapeHtml(v.pnr)}">${qrSvg}</div>`)}</body></html>`;
}

/** The email body; the QR is the attachment with Content-ID `qrCid`. */
export function renderTicketEmail(v: TicketView, qrCid: string): string {
  const intro =
    v.intro ?? `Your booking with ${v.operatorName} is confirmed. Here is your e-ticket.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(ticketSubject(v))}</title></head>
<body style="margin:0;padding:16px;background:#f3f4f6">
<div style="max-width:640px;margin:0 auto 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;white-space:pre-line">${escapeHtml(intro)}</div>
<div style="background:#ffffff;max-width:642px;margin:0 auto;border-radius:12px">${ticketBody(v, `<img src="cid:${escapeHtml(qrCid)}" width="110" height="110" alt="Boarding QR for PNR ${escapeHtml(v.pnr)}" style="display:block">`)}</div>
</body></html>`;
}
