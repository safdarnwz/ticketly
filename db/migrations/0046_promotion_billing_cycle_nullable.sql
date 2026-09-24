-- route_promotions now supports an explicit operator-chosen calendar
-- date-range (start-to-end from a date-picker), priced by decomposing the
-- exact day-count into the best combination of daily/weekly/monthly rate
-- buckets (see promotion-pricing.ts computeBucketPrice) — a 12-day
-- promotion might be "1 week + 5 days", which no single billing_cycle
-- value cleanly describes. The column stays for display/filtering
-- convenience (a pure single-bucket purchase, e.g. exactly 7 days, still
-- sets it to 'weekly'), but a mixed-bucket purchase now leaves it NULL
-- rather than forcing an inaccurate label.
ALTER TABLE route_promotions ALTER COLUMN billing_cycle DROP NOT NULL;
