-- #1220 (spec #1212): the automatic break divides through work records, whose outcomes
-- keep its intent deferred: a pair that disagrees (`canonical_divergence`), work in a
-- closed month found by the pre-check (`month_closed`) and work that changed under the
-- adjustment (`work_period_stale`). Existing rows keep their blockers.
ALTER TABLE "work_break_adjustment_intent" DROP CONSTRAINT "work_break_adjustment_intent_blocker_check";--> statement-breakpoint
ALTER TABLE "work_break_adjustment_intent" ADD CONSTRAINT "work_break_adjustment_intent_blocker_check" CHECK (("work_break_adjustment_intent"."status" = 'deferred') = ("work_break_adjustment_intent"."blocker" IS NOT NULL AND "work_break_adjustment_intent"."observed_graph_revision" IS NOT NULL AND "work_break_adjustment_intent"."deferred_at" IS NOT NULL) AND ("work_break_adjustment_intent"."blocker" IS NULL OR "work_break_adjustment_intent"."blocker" IN ('work_period_pending_approval', 'pending_time_correction_approval', 'completed_work_review_required', 'work_occupancy_conflict', 'append_review_required', 'canonical_divergence', 'month_closed', 'work_period_stale')));
