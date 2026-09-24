-- Pause/resume for an active promotion — distinct from cancel():
--   - cancel() ends the promotion permanently with a prorated REFUND for
--     the unused remainder (the operator gets money back, doesn't want
--     the remaining days at all).
--   - pause() is opt-OUT without giving up what was already paid for —
--     visibility stops immediately (a paused promotion is not 'active',
--     so SearchService's activePromotionsForRoutes simply won't match it),
--     but no money moves and no days are lost. resume() (opt back IN)
--     extends ends_at by exactly how long it was paused, so the operator
--     always gets the full number of days they originally paid for,
--     whenever they actually want them shown.
-- A promotion can be paused/resumed any number of times — paused_at is
-- reset to NULL on resume, so it never accumulates across cycles; the
-- extension math lives entirely in application code (see
-- PromotionService.resume), which reads paused_at at resume-time before
-- clearing it.
ALTER TABLE route_promotions
  ADD COLUMN paused_at timestamptz;

-- 'paused' joins the existing status vocabulary: pending_payment | active | paused | expired | cancelled
COMMENT ON COLUMN route_promotions.status IS
  'pending_payment: created but payment/platform_charge not yet settled — never shown in search. active: currently boosting search results. paused: operator opted out temporarily — not shown, but ends_at will extend on resume so no paid-for days are lost. expired: ends_at passed, not renewed. cancelled: ended early with a prorated refund — see PromotionService.cancel().';
