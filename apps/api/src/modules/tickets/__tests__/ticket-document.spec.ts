import { describe, expect, it } from 'vitest';

import {
  renderTicketEmail,
  renderTicketPage,
  ticketSubject,
  ticketText,
  type TicketView,
} from '../domain/ticket-document';

const view = (over: Partial<TicketView> = {}): TicketView => ({
  operatorName: 'Orange Travels',
  operatorGstin: '07AABCT1332L1ZU',
  operatorPhone: '01140000000',
  logoDataUri: null,
  pnr: 'P8SJAR',
  seatType: 'sleeper',
  from: { name: 'Kashmere Gate ISBT', landmark: 'Gate 3', at: new Date('2026-09-28T16:00:00Z') },
  to: { name: 'Sindhi Camp', landmark: null, at: new Date('2026-09-28T21:30:00Z') },
  passengers: [
    { seat: 'L15', name: 'Asha Verma', age: 31, gender: 'female' },
    { seat: 'L16', name: '<img src=x onerror=alert(1)>', age: 34, gender: 'male' },
  ],
  fareMinor: 280000,
  taxMinor: 14000,
  totalMinor: 294000,
  currency: 'INR',
  trackingUrl: 'https://ticketly.example/track/abc',
  qrToken: 'payload.sig',
  timeZone: 'Asia/Kolkata',
  ...over,
});

describe('e-ticket', () => {
  it('times are shown in the operator’s time zone, not the server’s', () => {
    const text = ticketText(view());
    expect(text).toContain('09:30 pm'); // 16:00Z = 21:30 IST
    const subject = ticketSubject(view());
    expect(subject).toMatch(/^e-Ticket — PNR P8SJAR · Kashmere Gate ISBT → Sindhi Camp · /);
    expect(subject).toMatch(/28 Sept?,? 2026/);
  });
  it('the email shows the QR from its inline attachment and escapes passenger names', () => {
    const html = renderTicketEmail(view(), 'qr-P8SJAR@ticket');
    expect(html).toContain('src="cid:qr-P8SJAR@ticket"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    for (const s of [
      'P8SJAR',
      'Seat L15',
      'Seat L16',
      'Sleeper',
      'Gate 3',
      '₹2,940.00',
      'separate email',
    ])
      expect(html).toContain(s);
  });
  it('uses the operator’s own wording as the opening text, escaped', () => {
    const html = renderTicketEmail(view({ intro: 'Thanks for booking <3' }), 'q');
    expect(html).toContain('Thanks for booking &lt;3');
  });
  it('the printable page runs no scripts and embeds the QR as SVG', () => {
    const page = renderTicketPage(view(), '<svg id="qr"></svg>');
    expect(page).not.toMatch(/<script/i);
    expect(page).toContain('<svg id="qr"></svg>');
  });
  it('a stop without a time still renders', () => {
    const html = renderTicketEmail(view({ from: { name: 'A', landmark: null, at: null } }), 'q');
    expect(html).toContain('Boarding point');
  });
});
