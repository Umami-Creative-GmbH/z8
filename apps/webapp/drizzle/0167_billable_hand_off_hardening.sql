-- #768 review fixes: one call per invoice draft at a time, and org-scoped foreign keys for hand-off rows.
-- Idempotent: replayed by migration-runner.integration.test.ts.

-- An in-flight claim on a pending draft: only the holder calls the accounting tool until the lease ends.
ALTER TABLE "invoice_draft" ADD COLUMN IF NOT EXISTS "call_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "invoice_draft" ADD COLUMN IF NOT EXISTS "call_claimed_until" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_call_claim_check" CHECK (("invoice_draft"."call_claim_token" IS NULL) = ("invoice_draft"."call_claimed_until" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Invoiced work references its work period within the same organization.
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_id_organizationId_idx" UNIQUE ("id","organization_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_work_period_fk" FOREIGN KEY ("work_period_id","organization_id") REFERENCES "public"."work_period"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "invoiced_work" DROP CONSTRAINT IF EXISTS "invoiced_work_work_period_id_work_period_id_fk";--> statement-breakpoint

-- Draft lines reference their project within the same organization.
DO $$ BEGIN
	ALTER TABLE "invoice_draft_line" ADD CONSTRAINT "invoice_draft_line_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_draft_line_organization_draft_idx" ON "invoice_draft_line" USING btree ("organization_id","invoice_draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_draft_line_organization_project_idx" ON "invoice_draft_line" USING btree ("organization_id","project_id") WHERE "invoice_draft_line"."project_id" IS NOT NULL;
