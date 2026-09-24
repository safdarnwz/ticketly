-- =============================================================================
-- 0035_platform_legal_pages
--
-- Consumer Protection (E-Commerce) Rules, 2020 (Rule 5) require every
-- e-commerce entity to prominently display: (a) its own legal name, GSTIN,
-- and grievance-redressal contact; (b) return/refund/cancellation terms;
-- (c) a grievance officer's name, designation, and contact, published on
-- the platform. The IT (Intermediary Guidelines) Rules, 2021 separately
-- require a published Privacy Policy and a Grievance Officer for any
-- platform handling user data/content.
--
-- These are PLATFORM-level pages (no tenant_id) — Ticketly itself, not any
-- individual bus operator, is the e-commerce entity operating the
-- storefront and the data fiduciary for what it collects there. Seeded
-- with real, substantive content matching what's ACTUALLY implemented
-- elsewhere in this codebase (the refund-policy tiers in
-- booking/domain/refund-policy.ts, the DPDP consent/erasure flow in the
-- privacy module) — a legal page that contradicts the running code is
-- worse than no page at all.
--
-- IMPORTANT: the contact details below (grievance officer name/email/
-- phone, registered address, GSTIN) are PLACEHOLDERS. Anthropic/Claude
-- cannot register a real company, obtain a real GSTIN, or appoint a real
-- grievance officer — the operator of this codebase MUST replace every
-- bracketed placeholder with their actual registered details before this
-- goes live, or the pages remain non-compliant despite existing.
-- =============================================================================

-- migrate:up

CREATE TABLE platform_legal_pages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  body_md     text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- No RLS — platform-wide, publicly readable by design (same pattern as announcements).

INSERT INTO platform_legal_pages (slug, title, body_md) VALUES
('terms', 'Terms of Service', $body$
# Terms of Service

**Last updated: [DATE — replace before going live]**

## 1. Who we are
Ticketly ("**we**", "**us**", "**the Platform**") is operated by **[LEGAL ENTITY NAME]**,
a company registered in India under the Companies Act, 2013 (CIN: **[CIN NUMBER]**),
having its registered office at **[REGISTERED ADDRESS]** and GST registration
number **[GSTIN]**.

## 2. What Ticketly is (and isn't)
Ticketly is a **ticketing marketplace**. We connect passengers with bus
operators and facilitate the booking and payment for seats on their
services. **The bus operator named on your ticket is the transport
provider and the party responsible for operating the journey** — the
vehicle, the driver, the route, and the standard of service. Ticketly's
own role is limited to: listing available services, processing your
payment, issuing your ticket, and providing customer support for booking
and payment issues.

## 3. Booking and payment
- Fares shown include the base fare, the operator's applicable GST, and
  Ticketly's own booking/convenience fee (where charged), each shown
  separately at checkout before you pay.
- A booking is confirmed only once payment is captured and a PNR is
  issued. A "held" (unpaid) seat selection expires automatically if
  payment is not completed within the hold window shown at checkout.
- We accept payment via the methods shown at checkout (UPI, cards, net
  banking, or your Ticketly Wallet balance). All non-wallet payments are
  processed by a licensed payment aggregator; Ticketly does not store your
  full card number.

## 4. Cancellations and refunds
See our separate **[Cancellation & Refund Policy](/legal/refund-policy)**,
which forms part of these Terms. Refund percentages depend on how far
before departure you cancel.

## 5. Your account
You are responsible for keeping your login credentials confidential and
for all activity under your account. Notify us immediately at
**[SUPPORT EMAIL]** if you suspect unauthorised access.

## 6. Ticketly Wallet
The Ticketly Wallet is a **closed-system prepaid instrument** as defined
under the Reserve Bank of India's Master Directions on Prepaid Payment
Instruments: wallet balance can only be used to pay for bookings on
Ticketly, cannot be transferred to any other person or wallet, and cannot
be withdrawn as cash. As a closed-system instrument, it does not require
a separate RBI authorisation. We may set a maximum wallet balance from
time to time to comply with applicable regulation.

## 7. Prohibited use
You agree not to: use the Platform for any unlawful purpose; resell
tickets for commercial gain without our written consent; attempt to
interfere with the Platform's security or normal operation; or submit
false, fraudulent, or misleading information at booking.

## 8. Limitation of liability
To the maximum extent permitted by the Consumer Protection Act, 2019 and
other applicable law, Ticketly's liability for any claim arising from a
booking is limited to the amount actually paid for that booking. We are
not liable for delays, cancellations, or service deficiencies caused
solely by the operator, force majeure, weather, traffic, or government
action — though we will assist you in pursuing a remedy against the
operator where appropriate.

## 9. Grievance redressal
See our **[Grievance Officer](/legal/grievance)** page for how to raise a
complaint and our response timelines under the Consumer Protection
(E-Commerce) Rules, 2020 and the IT (Intermediary Guidelines) Rules, 2021.

## 10. Governing law
These Terms are governed by the laws of India. Courts at **[CITY]** have
exclusive jurisdiction over any dispute, without prejudice to your right
to approach a consumer forum under the Consumer Protection Act, 2019 in
the jurisdiction where you reside.

## 11. Changes to these Terms
We may update these Terms from time to time. Material changes will be
notified on this page with a new "Last updated" date.
$body$),

('privacy', 'Privacy Policy', $body$
# Privacy Policy

**Last updated: [DATE — replace before going live]**

This Privacy Policy explains how **[LEGAL ENTITY NAME]** ("Ticketly", "we",
"us") collects, uses, stores, and shares your personal data, in
compliance with the **Digital Personal Data Protection Act, 2023** and the
Information Technology Act, 2000 and rules made under it.

## 1. What we collect
- **Identity & contact data**: name, phone number, email address —
  needed to issue your ticket and contact you about your journey.
- **Payment data**: handled by our licensed payment aggregator; we store
  only the payment method type and a masked reference, never your full
  card number or UPI PIN.
- **Booking history**: routes, dates, seats, and fares you've booked.
- **Location** (optional, only if you grant permission): to show nearby
  boarding points or your bus's live position on a trip you've booked.

## 2. Why we collect it (lawful purpose)
We process your personal data to: fulfil your booking (contractual
necessity); send transactional SMS/WhatsApp/email updates about your
trip; respond to support requests; detect and prevent fraud; and, only
where you've separately consented, send you promotional offers. You can
withdraw marketing consent at any time from **Account → Privacy**.

## 3. Who we share it with
- **The bus operator** you've booked with — your name, phone number, and
  seat details, so they can operate your journey and contact you about
  it.
- **Payment aggregators/banks** — to process your payment, as required to
  complete the transaction.
- **SMS/WhatsApp providers** — to deliver your booking confirmation and
  reminders.
- We do **not** sell your personal data to third parties for their own
  marketing.

## 4. Your rights under the DPDP Act, 2023
You have the right to: access the personal data we hold about you;
correct inaccurate data; withdraw consent for optional processing (e.g.
marketing); and request erasure of your data, subject to our legal
obligation to retain booking/tax records for the period required by the
Income Tax Act, 1961 and GST law. Exercise these rights from
**Account → Privacy**, or by writing to our Grievance Officer (see the
[Grievance Officer](/legal/grievance) page).

## 5. Data retention
We retain booking and payment records for as long as required under
applicable tax and consumer-protection law (typically not less than the
statutory limitation period), and delete or anonymise other personal
data once it is no longer needed for the purpose it was collected for.

## 6. Data security
We use encryption in transit (TLS) and at rest for sensitive fields
(such as your phone number and email), role-based access control for our
staff, and maintain audit logs of access to customer data.

## 7. Cookies
We use strictly necessary cookies to keep you signed in and remember
your search preferences. We do not use third-party advertising cookies.

## 8. Grievance Officer / Data Protection contact
See our [Grievance Officer](/legal/grievance) page for how to raise a
privacy complaint or exercise your DPDP Act rights.

## 9. Changes to this Policy
We may update this Policy from time to time. Material changes will be
notified on this page with a new "Last updated" date.
$body$),

('refund-policy', 'Cancellation & Refund Policy', $body$
# Cancellation & Refund Policy

**Last updated: [DATE — replace before going live]**

This policy is displayed to you before you complete payment, as required
under the Consumer Protection (E-Commerce) Rules, 2020.

## How much you get back
Your refund on cancellation depends on how long before the trip's
scheduled departure you cancel:

| Cancel at least... | Refund |
|---|---|
| 24 hours before departure | 90% of the fare paid |
| 6 hours before departure | 75% of the fare paid |
| 2 hours before departure | 50% of the fare paid |
| Less than 2 hours / after departure | Not refundable |

These percentages apply to the **fare and GST portion** you paid.
Ticketly's own booking/convenience fee, where charged, is non-refundable
once payment is captured, since it covers the cost of processing your
booking regardless of whether you later travel.

## How refunds are paid
- If you paid by UPI, card, or net banking, your refund is credited back
  to the **original payment method**, typically within 5-7 business days,
  subject to your bank's processing time.
- If you paid using your Ticketly Wallet balance, the refund is credited
  **instantly** back to your Wallet.
- Refunds are never issued in cash.

## Operator-side cancellations
If the **operator** cancels or significantly reschedules your trip (not
you), you are entitled to a **100% refund** regardless of how close to
departure the cancellation happens, since the service could not be
delivered as booked.

## How to cancel
Cancel from **Account → My Bookings → [your booking] → Cancel**, or
contact support with your PNR. Cancellation takes effect immediately on
confirmation; the refund percentage is calculated at the moment you
cancel, not when support processes the request.

## Disputes
If you believe a refund was calculated incorrectly, contact our
[Grievance Officer](/legal/grievance) with your PNR and we will review it
within the timelines set out on that page.
$body$),

('grievance', 'Grievance Officer', $body$
# Grievance Officer

**Last updated: [DATE — replace before going live]**

In accordance with the Consumer Protection (E-Commerce) Rules, 2020 and
the Information Technology (Intermediary Guidelines and Digital Media
Ethics Code) Rules, 2021, the following Grievance Officer has been
appointed to address complaints from users of Ticketly:

**Name:** [GRIEVANCE OFFICER NAME]
**Designation:** [DESIGNATION]
**Company:** [LEGAL ENTITY NAME]
**Address:** [REGISTERED ADDRESS]
**Email:** [GRIEVANCE EMAIL, e.g. grievance@ticketly.com]
**Phone:** [PHONE NUMBER], **[DAYS/HOURS, e.g. Monday-Saturday, 10 AM-6 PM IST]**

## What you can complain about
Booking or payment issues, refund disputes, operator service
deficiencies, data-privacy concerns, or any other grievance related to
your use of the Platform.

## What to include
Your registered mobile number or email, your booking PNR (if
applicable), and a description of the issue. This helps us resolve your
complaint faster.

## Our response timelines
- **Acknowledgement**: within **48 hours** of receiving your complaint.
- **Resolution**: within **30 days**, as required under the Consumer
  Protection (E-Commerce) Rules, 2020 — most booking and refund issues
  are resolved much sooner.

## If you're not satisfied
If your complaint is not resolved to your satisfaction, you may approach:
- The **National Consumer Helpline** (toll-free **1915**, or
  consumerhelpline.gov.in), or
- Your local **Consumer Disputes Redressal Commission** under the
  Consumer Protection Act, 2019, or
- The **Data Protection Board of India** for complaints specifically
  about how we've handled your personal data under the DPDP Act, 2023.
$body$)
ON CONFLICT (slug) DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS platform_legal_pages;
