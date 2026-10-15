-- #1224 (spec #1212): every completed work period has a canonical work record.
-- Live work gets its record when Clocking hands it to work records at clock-out, and
-- deleted work is no longer work. Added NOT VALID: the check applies to new and changed
-- rows only. Half pairs already stored stay as they are; the canonical backfill and
-- reopening a month attach their records through work records, and those left in a
-- closed month cannot change at all (Time Tracking ADR-0004, no exemption).
ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_completed_has_canonical_record_chk" CHECK ("work_period"."is_active" OR "work_period"."deleted_at" IS NOT NULL OR "work_period"."canonical_record_id" IS NOT NULL) NOT VALID;
