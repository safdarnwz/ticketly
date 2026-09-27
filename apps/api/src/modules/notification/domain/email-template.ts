/**
 * ============================================================================
 *  Themed transactional email templates
 * ============================================================================
 *
 * Every Ticketly email (OTP, welcome, booking confirmation, operator status) is
 * rendered from the SAME themed shell so it matches the product's look — the
 * palette is the operator's appearance theme (or the platform default), so a
 * re-skin in Global Settings flows through to email too. Pure string building,
 * no I/O — the exact HTML is unit-testable and identical everywhere.
 */

export interface EmailPalette {
  primary: string;
  primaryFg: string;
  accent: string;
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
}

export const DEFAULT_EMAIL_PALETTE: EmailPalette = {
  primary: '#3F5475',
  primaryFg: '#FFFFFF',
  accent: '#F0628F',
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#2F3E5C',
  textMuted: '#8390A8',
  border: '#E1E6EF',
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** The shared themed shell every email is rendered into. */
export function renderEmail(input: {
  palette?: EmailPalette;
  brandName?: string;
  title: string;
  heading: string;
  bodyHtml: string; // trusted, pre-escaped HTML fragment
  cta?: { label: string; url: string };
  footerNote?: string;
}): string {
  const p = input.palette ?? DEFAULT_EMAIL_PALETTE;
  const brand = input.brandName ?? 'Ticketly';
  const cta = input.cta
    ? `<tr><td style="padding:8px 0 4px">
         <a href="${esc(input.cta.url)}" style="display:inline-block;background:${p.primary};color:${p.primaryFg};
            text-decoration:none;font-weight:500;padding:12px 20px;border-radius:8px">${esc(input.cta.label)}</a>
       </td></tr>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width"><title>${esc(input.title)}</title></head>
<body style="margin:0;background:${p.bg};font-family:Inter,Segoe UI,Arial,sans-serif;color:${p.text}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.bg};padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="width:560px;max-width:92%;background:${p.surface};border:1px solid ${p.border};border-radius:12px;overflow:hidden">
        <tr><td style="background:${p.primary};padding:20px 28px">
          <span style="color:${p.primaryFg};font-size:20px;font-weight:600;letter-spacing:-.01em">${esc(brand)}</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 12px;font-size:20px;color:${p.text}">${esc(input.heading)}</h1>
          <div style="font-size:14px;line-height:1.6;color:${p.text}">${input.bodyHtml}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px">${cta}</table>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid ${p.border};color:${p.textMuted};font-size:12px">
          ${esc(input.footerNote ?? `You’re receiving this because of activity on your ${brand} account.`)}
        </td></tr>
      </table>
      <div style="color:${p.textMuted};font-size:11px;margin-top:12px">© ${brand}</div>
    </td></tr>
  </table>
</body></html>`;
}

export function renderOtpEmail(opts: {
  palette?: EmailPalette;
  brandName?: string;
  code: string;
  name?: string;
  purpose?: string;
}): string {
  const p = opts.palette ?? DEFAULT_EMAIL_PALETTE;
  const reason = opts.purpose === 'register' ? 'complete your registration' : 'sign in';
  return renderEmail({
    palette: p,
    brandName: opts.brandName,
    title: 'Your verification code',
    heading: `Hi ${opts.name ? esc(opts.name) : 'there'}, here’s your code`,
    bodyHtml: `<p>Use this one-time code to ${reason}. It expires in 5 minutes.</p>
      <div style="margin:16px 0;text-align:center">
        <span style="display:inline-block;font-size:30px;font-weight:600;letter-spacing:8px;color:${p.primary};
          background:${p.bg};border:1px dashed ${p.border};border-radius:10px;padding:14px 22px">${esc(opts.code)}</span>
      </div>
      <p style="color:${p.textMuted}">If you didn’t request this, you can safely ignore this email.</p>`,
    footerNote: 'Never share this code with anyone.',
  });
}

export function renderWelcomeEmail(opts: { palette?: EmailPalette; name: string }): string {
  return renderEmail({
    palette: opts.palette,
    title: 'Welcome to Ticketly',
    heading: `Welcome aboard, ${esc(opts.name)}! 🎉`,
    bodyHtml: `<p>Your Ticketly account is ready. You can now book tickets, manage trips and download e-tickets in one place.</p>`,
    cta: { label: 'Book a trip', url: 'https://ticketly.com' },
  });
}

export function renderBookingConfirmedEmail(opts: {
  palette?: EmailPalette;
  name?: string;
  pnr: string;
  route: string;
  departAt: string;
  seats: string;
  totalFormatted: string;
}): string {
  return renderEmail({
    palette: opts.palette,
    title: `Booking confirmed — ${opts.pnr}`,
    heading: 'Your booking is confirmed ✅',
    bodyHtml: `<p>${opts.name ? `Hi ${esc(opts.name)}, ` : ''}your seats are booked.</p>
      <table role="presentation" style="width:100%;font-size:14px;margin-top:8px">
        <tr><td style="padding:6px 0;color:#6B7280">PNR</td><td style="padding:6px 0;text-align:right;font-weight:700">${esc(opts.pnr)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B7280">Route</td><td style="padding:6px 0;text-align:right">${esc(opts.route)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B7280">Departs</td><td style="padding:6px 0;text-align:right">${esc(opts.departAt)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B7280">Seats</td><td style="padding:6px 0;text-align:right">${esc(opts.seats)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B7280">Total paid</td><td style="padding:6px 0;text-align:right;font-weight:700">${esc(opts.totalFormatted)}</td></tr>
      </table>`,
    cta: { label: 'View / print ticket', url: 'https://ticketly.com/bookings' },
  });
}

export function renderOperatorStatusEmail(opts: {
  palette?: EmailPalette;
  name: string;
  /** 'on_hold' = still pending, more information requested; 'reopened' = a rejected application is back under review. */
  status: 'approved' | 'rejected' | 'on_hold' | 'reopened';
  reason?: string;
  /** The operator's OWN console URL (`https://app.<slug>.ticketly.com`) — only set when approved. */
  consoleUrl?: string;
}): string {
  const reasonHtml = opts.reason ? `<p style="color:#6B7280">Reason: ${esc(opts.reason)}</p>` : '';
  const name = esc(opts.name);
  const variants = {
    approved: {
      heading: 'Your operator application is approved',
      body: `<p>Hi ${name}, your operator account has been approved and activated. You can now sign in to your own operator console and start setting up routes, buses and schedules.</p>
         ${opts.consoleUrl ? `<p>Your console: <strong>${esc(opts.consoleUrl)}</strong></p>` : ''}
         <p>Note: every bus you add must have its documents verified by our team before it can be scheduled.</p>`,
    },
    rejected: {
      heading: 'Update on your operator application',
      body: `<p>Hi ${name}, unfortunately your operator application was not approved.</p>${reasonHtml}
         <p>You're welcome to reapply with updated details.</p>`,
    },
    on_hold: {
      heading: 'We need a little more from you',
      body: `<p>Hi ${name}, your operator application is still under review, but our team needs something from you before we can continue.</p>${reasonHtml}
         <p>Please reply to this email with the requested details or documents.</p>`,
    },
    reopened: {
      heading: 'Your operator application is back under review',
      body: `<p>Hi ${name}, your application has been reopened and is under review again.</p>${reasonHtml}`,
    },
  } as const;
  const v = variants[opts.status];
  return renderEmail({
    palette: opts.palette,
    title: `Operator application — ${opts.status.replace('_', ' ')}`,
    heading: v.heading,
    bodyHtml: v.body,
    cta:
      opts.status === 'approved'
        ? { label: 'Go to console', url: opts.consoleUrl ?? 'https://app.ticketly.com' }
        : undefined,
  });
}
