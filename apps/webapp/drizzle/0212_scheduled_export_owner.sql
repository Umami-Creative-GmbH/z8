-- Schedule owner (#988 slice 1): the org admin a scheduled export acts on behalf of. Each
-- existing schedule's owner becomes its creator. A schedule whose creator is no longer an org
-- admin is not paused here: the scheduled-exports cron pauses it on its next tick, writes the
-- audit entry and notifies the organization's admins, as it does for any owner who loses
-- admin rights. An added enum value is not usable in the transaction that adds it, so nothing
-- below uses 'scheduled_export_paused'.
ALTER TABLE "scheduled_export" ADD COLUMN IF NOT EXISTS "owner_id" text;--> statement-breakpoint
UPDATE "scheduled_export" SET "owner_id" = "created_by" WHERE "owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "scheduled_export" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduledExport_org_owner_idx" ON "scheduled_export" USING btree ("organization_id","owner_id");--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'scheduled_export_paused';
