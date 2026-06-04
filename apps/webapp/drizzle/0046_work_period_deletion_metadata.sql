ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deleted_by" text;
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deletion_reason" text;
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "deletion_approval_request_id" uuid;

DO $$ BEGIN
 ALTER TABLE "work_period" ADD CONSTRAINT "work_period_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "user"("id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "work_period" ADD CONSTRAINT "work_period_deletion_approval_request_org_fk" FOREIGN KEY ("deletion_approval_request_id", "organization_id") REFERENCES "approval_request"("id", "organization_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "workPeriod_org_deletedAt_idx" ON "work_period" ("organization_id", "deleted_at");
