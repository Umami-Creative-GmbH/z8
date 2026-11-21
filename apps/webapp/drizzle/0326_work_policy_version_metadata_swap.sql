-- Phase 2B (0326): 100% O(1) metadata-only SET NOT NULL, UNIQUE USING INDEX attachment,
-- legacy unique / location FK / Policy Bridge Trigger removal under 9-table NOWAIT lock.
-- Leaves work_policy_version v1 unsealed (sealed_cutover_at IS NULL) for Drain Gate 2.

SET LOCAL statement_timeout = '250ms';
--> statement-breakpoint
LOCK TABLE
	"work_policy",
	"work_policy_version",
	"work_policy_schedule",
	"work_policy_schedule_day",
	"work_policy_presence",
	"work_policy_regulation",
	"work_policy_break_rule",
	"work_policy_break_option",
	"location"
IN ACCESS EXCLUSIVE MODE NOWAIT;
--> statement-breakpoint
ALTER TABLE "work_policy_schedule"
	ALTER COLUMN "policy_version_id" SET NOT NULL,
	DROP CONSTRAINT "work_policy_schedule_policy_version_not_null_check",
	ADD CONSTRAINT "work_policy_schedule_version_uidx" UNIQUE USING INDEX "work_policy_schedule_version_uidx",
	ADD CONSTRAINT "work_policy_schedule_id_version_uidx" UNIQUE USING INDEX "work_policy_schedule_id_version_uidx",
	DROP CONSTRAINT IF EXISTS "work_policy_schedule_policy_id_unique";
--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day"
	ALTER COLUMN "policy_version_id" SET NOT NULL,
	DROP CONSTRAINT "work_policy_schedule_day_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	ALTER COLUMN "policy_version_id" SET NOT NULL,
	DROP CONSTRAINT "work_policy_presence_policy_version_not_null_check",
	ADD CONSTRAINT "work_policy_presence_version_uidx" UNIQUE USING INDEX "work_policy_presence_version_uidx",
	DROP CONSTRAINT IF EXISTS "work_policy_presence_policy_id_unique",
	DROP CONSTRAINT IF EXISTS "work_policy_presence_location_id_location_id_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	RENAME CONSTRAINT "work_policy_presence_location_id_no_action_fk"
	TO "work_policy_presence_location_id_location_id_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_regulation"
	ALTER COLUMN "policy_version_id" SET NOT NULL,
	DROP CONSTRAINT "work_policy_regulation_policy_version_not_null_check",
	ADD CONSTRAINT "work_policy_regulation_version_uidx" UNIQUE USING INDEX "work_policy_regulation_version_uidx",
	ADD CONSTRAINT "work_policy_regulation_id_version_uidx" UNIQUE USING INDEX "work_policy_regulation_id_version_uidx",
	DROP CONSTRAINT IF EXISTS "work_policy_regulation_policy_id_unique";
--> statement-breakpoint
ALTER TABLE "work_policy_break_rule"
	ALTER COLUMN "policy_version_id" SET NOT NULL,
	DROP CONSTRAINT "work_policy_break_rule_policy_version_not_null_check",
	ADD CONSTRAINT "work_policy_break_rule_id_version_uidx" UNIQUE USING INDEX "work_policy_break_rule_id_version_uidx";
--> statement-breakpoint
ALTER TABLE "work_policy_break_option"
	ALTER COLUMN "policy_version_id" SET NOT NULL,
	DROP CONSTRAINT "work_policy_break_option_policy_version_not_null_check";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_sync_v1" ON "work_policy";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_version" ON "work_policy_schedule";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_presence_version" ON "work_policy_presence";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_regulation_version" ON "work_policy_regulation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_day_version" ON "work_policy_schedule_day";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_rule_version" ON "work_policy_break_rule";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_option_version" ON "work_policy_break_option";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_violation_version" ON "work_policy_violation";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_sync_v1"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_direct_child_version"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_schedule_day_version"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_break_rule_version"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_break_option_version"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_violation_version"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_ensure_work_policy_v1"(uuid);
