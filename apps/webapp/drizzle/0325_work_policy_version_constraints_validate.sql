-- Phase 2B (0325): Non-blocking VALIDATE CONSTRAINT across policy child/grandchild tables,
-- replacement location FK, and work_policy_violation constraints (SHARE UPDATE EXCLUSIVE + ROW SHARE).

ALTER TABLE "work_policy_schedule"
	VALIDATE CONSTRAINT "work_policy_schedule_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day"
	VALIDATE CONSTRAINT "work_policy_schedule_day_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	VALIDATE CONSTRAINT "work_policy_presence_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_regulation"
	VALIDATE CONSTRAINT "work_policy_regulation_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_break_rule"
	VALIDATE CONSTRAINT "work_policy_break_rule_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_break_option"
	VALIDATE CONSTRAINT "work_policy_break_option_policy_version_not_null_check";
--> statement-breakpoint
ALTER TABLE "work_policy_schedule"
	VALIDATE CONSTRAINT "work_policy_schedule_policy_version_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day"
	VALIDATE CONSTRAINT "work_policy_schedule_day_schedule_version_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	VALIDATE CONSTRAINT "work_policy_presence_policy_version_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_regulation"
	VALIDATE CONSTRAINT "work_policy_regulation_policy_version_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_break_rule"
	VALIDATE CONSTRAINT "work_policy_break_rule_regulation_version_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_break_option"
	VALIDATE CONSTRAINT "work_policy_break_option_break_rule_version_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	VALIDATE CONSTRAINT "work_policy_presence_location_id_no_action_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_violation"
	VALIDATE CONSTRAINT "work_policy_violation_version_requires_policy_check";
--> statement-breakpoint
ALTER TABLE "work_policy_violation"
	VALIDATE CONSTRAINT "work_policy_violation_policy_version_fk";
