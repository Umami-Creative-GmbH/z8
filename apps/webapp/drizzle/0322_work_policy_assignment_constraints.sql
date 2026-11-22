-- Phase 2A (0322): Work policy assignment constraints, composite tenant FKs,
-- per-scope btree_gist exclusion constraints, and partial source_batch_item_id uniqueness.
-- Runs in an isolated transaction after chunked backfill completeness and overlap pre-clean.

SET LOCAL lock_timeout = '500ms';
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_assignment_sync" ON "work_policy_assignment";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_work_policy_assignment_sync"();
--> statement-breakpoint
DROP INDEX IF EXISTS "workPolicyAssignment_org_default_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "workPolicyAssignment_team_idx";
--> statement-breakpoint
ALTER TABLE "contract_default"
	ADD CONSTRAINT "contract_default_id_org_unique" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD COLUMN IF NOT EXISTS "source_batch_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ALTER COLUMN "effective_from_date" SET DEFAULT DATE '1970-01-01',
	ALTER COLUMN "effective_from_date" SET NOT NULL,
	ALTER COLUMN "source_kind" SET DEFAULT 'legacy',
	ALTER COLUMN "source_kind" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	DROP CONSTRAINT IF EXISTS "work_policy_assignment_source_kind_check";
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_kind_check"
	CHECK ("source_kind" IN ('contract_default', 'employment_terms', 'manager_assignment', 'legacy'));
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_scope_target_check"
	CHECK ((
		("assignment_type" = 'organization' AND "team_id" IS NULL AND "employee_id" IS NULL AND "priority" = 0)
		OR ("assignment_type" = 'team' AND "team_id" IS NOT NULL AND "employee_id" IS NULL AND "priority" = 1)
		OR ("assignment_type" = 'employee' AND "team_id" IS NULL AND "employee_id" IS NOT NULL AND "priority" = 2)
	) IS TRUE);
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_provenance_check"
	CHECK ((
		(
			"source_kind" = 'contract_default'
			AND "assignment_type" IN ('organization', 'team')
			AND "source_contract_default_id" IS NOT NULL
			AND "source_employment_history_id" IS NULL
		)
		OR (
			"source_kind" = 'employment_terms'
			AND "assignment_type" = 'employee'
			AND "source_contract_default_id" IS NULL
		)
		OR (
			"source_kind" = 'manager_assignment'
			AND "assignment_type" = 'employee'
			AND "source_contract_default_id" IS NULL
			AND "source_employment_history_id" IS NULL
		)
		OR (
			"source_kind" = 'legacy'
			AND "source_contract_default_id" IS NULL
			AND "source_employment_history_id" IS NULL
		)
	) IS TRUE);
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_date_range_check"
	CHECK ("effective_until_date" IS NULL OR "effective_until_date" > "effective_from_date");
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	DROP CONSTRAINT IF EXISTS "work_policy_assignment_source_contract_default_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	DROP CONSTRAINT IF EXISTS "work_policy_assignment_source_employment_history_fk";
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_policy_tenant_fk"
	FOREIGN KEY ("policy_id", "organization_id")
	REFERENCES "work_policy"("id", "organization_id")
	ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_team_tenant_fk"
	FOREIGN KEY ("team_id", "organization_id")
	REFERENCES "team"("id", "organization_id")
	ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_employee_tenant_fk"
	FOREIGN KEY ("employee_id", "organization_id")
	REFERENCES "employee"("id", "organization_id")
	ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_contract_default_fk"
	FOREIGN KEY ("source_contract_default_id", "organization_id")
	REFERENCES "contract_default"("id", "organization_id")
	ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_source_employment_history_fk"
	FOREIGN KEY ("source_employment_history_id", "organization_id")
	REFERENCES "employee_employment_history"("id", "organization_id")
	ON DELETE SET NULL ("source_employment_history_id");
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_batch_item_fk"
	FOREIGN KEY ("source_batch_item_id", "organization_id")
	REFERENCES "contract_change_batch_item"("id", "organization_id")
	ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_org_no_overlap_excl"
	EXCLUDE USING gist (
		"organization_id" WITH =,
		daterange("effective_from_date", "effective_until_date", '[)') WITH &&
	)
	WHERE ("assignment_type" = 'organization' AND "is_active" = true);
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_team_no_overlap_excl"
	EXCLUDE USING gist (
		"organization_id" WITH =,
		"team_id" WITH =,
		daterange("effective_from_date", "effective_until_date", '[)') WITH &&
	)
	WHERE ("assignment_type" = 'team' AND "is_active" = true);
--> statement-breakpoint
ALTER TABLE "work_policy_assignment"
	ADD CONSTRAINT "work_policy_assignment_employee_no_overlap_excl"
	EXCLUDE USING gist (
		"organization_id" WITH =,
		"employee_id" WITH =,
		daterange("effective_from_date", "effective_until_date", '[)') WITH &&
	)
	WHERE ("assignment_type" = 'employee' AND "is_active" = true);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workPolicyAssignment_source_batch_item_uidx"
	ON "work_policy_assignment" ("source_batch_item_id")
	WHERE "source_batch_item_id" IS NOT NULL;
