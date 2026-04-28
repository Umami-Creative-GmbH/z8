CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"selected_scope" jsonb NOT NULL,
	"date_range" jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_by" text NOT NULL,
	"reviewed_by" text,
	"committed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "importBatch_id_organizationId_idx" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "import_batch_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"entity_type" text NOT NULL,
	"partition_key" text NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_staged_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"provider_source_id" text NOT NULL,
	"source_payload_hash" text NOT NULL,
	"source_payload" jsonb NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"match_target" jsonb,
	"row_status" text DEFAULT 'staged' NOT NULL,
	"issue_severity" text DEFAULT 'none' NOT NULL,
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp,
	"commit_target_table" text,
	"commit_target_id" text,
	"commit_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "importStagedRow_id_batch_org_idx" UNIQUE("id","batch_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "import_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"staged_row_id" uuid,
	"issue_type" text NOT NULL,
	"severity" text NOT NULL,
	"cluster_key" text,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detection_rule_version" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rejected_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"exported_by" text NOT NULL,
	"row_count" integer NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_committed_by_user_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_job" ADD CONSTRAINT "import_batch_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_job" ADD CONSTRAINT "import_batch_job_batch_org_import_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."import_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staged_row" ADD CONSTRAINT "import_staged_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staged_row" ADD CONSTRAINT "import_staged_row_batch_org_import_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."import_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staged_row" ADD CONSTRAINT "import_staged_row_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_issue" ADD CONSTRAINT "import_issue_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_issue" ADD CONSTRAINT "import_issue_batch_org_import_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."import_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_issue" ADD CONSTRAINT "import_issue_staged_row_batch_org_import_staged_row_fk" FOREIGN KEY ("staged_row_id","batch_id","organization_id") REFERENCES "public"."import_staged_row"("id","batch_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rejected_export" ADD CONSTRAINT "import_rejected_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rejected_export" ADD CONSTRAINT "import_rejected_export_batch_org_import_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."import_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rejected_export" ADD CONSTRAINT "import_rejected_export_exported_by_user_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_secret" ADD CONSTRAINT "import_job_secret_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_secret" ADD CONSTRAINT "import_job_secret_batch_org_import_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."import_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "importBatch_organizationId_idx" ON "import_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "importBatch_status_idx" ON "import_batch" USING btree ("status");--> statement-breakpoint
CREATE INDEX "importBatch_org_status_created_idx" ON "import_batch" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "importBatchJob_batchId_idx" ON "import_batch_job" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "importBatchJob_org_status_idx" ON "import_batch_job" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "importBatchJob_batch_kind_partition_idx" ON "import_batch_job" USING btree ("batch_id","kind","partition_key");--> statement-breakpoint
CREATE INDEX "importStagedRow_batchId_idx" ON "import_staged_row" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "importStagedRow_org_entity_idx" ON "import_staged_row" USING btree ("organization_id","entity_type");--> statement-breakpoint
CREATE INDEX "importStagedRow_status_idx" ON "import_staged_row" USING btree ("row_status");--> statement-breakpoint
CREATE UNIQUE INDEX "importStagedRow_batch_source_unique_idx" ON "import_staged_row" USING btree ("batch_id","entity_type","provider_source_id","source_payload_hash");--> statement-breakpoint
CREATE INDEX "importIssue_batchId_idx" ON "import_issue" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "importIssue_org_type_idx" ON "import_issue" USING btree ("organization_id","issue_type");--> statement-breakpoint
CREATE INDEX "importIssue_clusterKey_idx" ON "import_issue" USING btree ("cluster_key");--> statement-breakpoint
CREATE INDEX "importRejectedExport_batchId_idx" ON "import_rejected_export" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "importRejectedExport_organizationId_idx" ON "import_rejected_export" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "importJobSecret_batchId_idx" ON "import_job_secret" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "importJobSecret_organizationId_idx" ON "import_job_secret" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "importJobSecret_expiresAt_idx" ON "import_job_secret" USING btree ("expires_at");
