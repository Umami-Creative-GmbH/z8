CREATE TYPE "public"."implementation_checklist_manual_status" AS ENUM('complete', 'incomplete');--> statement-breakpoint
CREATE TABLE "implementation_checklist_manual_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"status" "implementation_checklist_manual_status" DEFAULT 'complete' NOT NULL,
	"completed_at" timestamp,
	"completed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "implementation_checklist_manual_state" ADD CONSTRAINT "implementation_checklist_manual_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "implementation_checklist_manual_state" ADD CONSTRAINT "implementation_checklist_manual_state_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "implementationChecklistManualState_org_item_idx" ON "implementation_checklist_manual_state" USING btree ("organization_id","item_id");--> statement-breakpoint
CREATE INDEX "implementationChecklistManualState_organizationId_idx" ON "implementation_checklist_manual_state" USING btree ("organization_id");
