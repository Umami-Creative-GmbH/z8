ALTER TABLE "import_batch" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "import_batch_job" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "import_staged_row" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "importIssue_retry_unique_idx" ON "import_issue" USING btree ("batch_id","organization_id","staged_row_id","issue_type","cluster_key","detection_rule_version") NULLS NOT DISTINCT;
