-- =============================================================================
-- 0036_tenant_gstin
--
-- The operator's GSTIN was captured at application time
-- (operator_applications.gst_number) but never copied onto the tenant
-- record at approval — so InvoiceConsumer's automatic invoice-issuance
-- (on booking.confirmed, the REAL path almost every invoice goes through)
-- had no supplier GSTIN to pass to InvoiceService.issueForBooking, leaving
-- out one of CGST Rule 46's mandatory tax-invoice fields on every
-- auto-issued invoice. See OnboardingService.approve and
-- InvoiceConsumer for the corresponding code fix.
--
-- registered_address is added alongside it — Rule 46 also requires the
-- supplier's address on the invoice, which the tenant record had no field
-- for either (only bank details and contact info).
-- =============================================================================

-- migrate:up

ALTER TABLE tenants ADD COLUMN gstin text;
ALTER TABLE tenants ADD COLUMN registered_address text;

-- migrate:down

ALTER TABLE tenants DROP COLUMN IF EXISTS registered_address;
ALTER TABLE tenants DROP COLUMN IF EXISTS gstin;
