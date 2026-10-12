-- Approval settings (#1015, spec #802, Approvals ADR 0002): organization-wide
-- approval switches. No row means the defaults, so "Deputies can decide
-- approvals" is on for existing and new organizations without a backfill. The
-- uuid `id` is the audit log's target of a change.
CREATE TABLE IF NOT EXISTS "approval_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"deputy_decisions_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "approval_setting_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "approval_setting" ADD CONSTRAINT "approval_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_setting" ADD CONSTRAINT "approval_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
