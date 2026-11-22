-- Phase 2B (0324): Instant O(1) NOT VALID policy-version constraints prep under 9-table NOWAIT lock.
-- Runs after pre-0324 final delta reconciliation and concurrent creation of all 6 policy-version staging indexes.

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
	ADD CONSTRAINT "work_policy_schedule_policy_version_not_null_check"
	CHECK ("policy_version_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day"
	ADD CONSTRAINT "work_policy_schedule_day_policy_version_not_null_check"
	CHECK ("policy_version_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	ADD CONSTRAINT "work_policy_presence_policy_version_not_null_check"
	CHECK ("policy_version_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_regulation"
	ADD CONSTRAINT "work_policy_regulation_policy_version_not_null_check"
	CHECK ("policy_version_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_break_rule"
	ADD CONSTRAINT "work_policy_break_rule_policy_version_not_null_check"
	CHECK ("policy_version_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_break_option"
	ADD CONSTRAINT "work_policy_break_option_policy_version_not_null_check"
	CHECK ("policy_version_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_schedule"
	ADD CONSTRAINT "work_policy_schedule_policy_version_fk"
	FOREIGN KEY ("policy_version_id", "policy_id")
	REFERENCES "work_policy_version"("id", "policy_id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day"
	ADD CONSTRAINT "work_policy_schedule_day_schedule_version_fk"
	FOREIGN KEY ("schedule_id", "policy_version_id")
	REFERENCES "work_policy_schedule"("id", "policy_version_id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_presence"
	ADD CONSTRAINT "work_policy_presence_policy_version_fk"
	FOREIGN KEY ("policy_version_id", "policy_id")
	REFERENCES "work_policy_version"("id", "policy_id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_regulation"
	ADD CONSTRAINT "work_policy_regulation_policy_version_fk"
	FOREIGN KEY ("policy_version_id", "policy_id")
	REFERENCES "work_policy_version"("id", "policy_id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_break_rule"
	ADD CONSTRAINT "work_policy_break_rule_regulation_version_fk"
	FOREIGN KEY ("regulation_id", "policy_version_id")
	REFERENCES "work_policy_regulation"("id", "policy_version_id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_policy_break_option"
	ADD CONSTRAINT "work_policy_break_option_break_rule_version_fk"
	FOREIGN KEY ("break_rule_id", "policy_version_id")
	REFERENCES "work_policy_break_rule"("id", "policy_version_id")
	ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
-- DEFERRABLE INITIALLY DEFERRED refuses direct single-location deletion while preserving
-- full-organization cascade teardown (where organization -> location runs before work_policy).
ALTER TABLE "work_policy_presence"
	ADD CONSTRAINT "work_policy_presence_location_id_no_action_fk"
	FOREIGN KEY ("location_id")
	REFERENCES "location"("id")
	ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED NOT VALID;
