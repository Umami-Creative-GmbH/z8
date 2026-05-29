ALTER TABLE "work_policy_preset" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "work_policy_preset" ADD CONSTRAINT "work_policy_preset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_preset" DROP CONSTRAINT IF EXISTS "work_policy_preset_name_unique";--> statement-breakpoint
CREATE INDEX "workPolicyPreset_organizationId_idx" ON "work_policy_preset" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyPreset_system_name_idx" ON "work_policy_preset" USING btree ("name") WHERE "organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyPreset_org_name_idx" ON "work_policy_preset" USING btree ("organization_id","name") WHERE "organization_id" IS NOT NULL;
