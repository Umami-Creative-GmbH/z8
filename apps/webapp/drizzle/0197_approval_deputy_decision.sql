-- Deputy decisions (#1016, spec #802, Approvals ADR 0002): the acting-for
-- record. One row per approval decision a covering deputy made for an absent
-- approver, legacy or canonical, written in the decision's transaction. The
-- approver stays assigned; this row names both people and the absence that
-- made the cover, for history, audit, deputy cards and cover summaries.
CREATE TABLE IF NOT EXISTS "approval_deputy_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"deputy_employee_id" uuid NOT NULL,
	"acting_for_employee_id" uuid NOT NULL,
	"absence_id" uuid,
	"authority" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"approval_request_id" uuid,
	"workflow_id" uuid,
	"assignment_id" uuid,
	"decision" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_deputy_decision_shape_check" CHECK ("approval_deputy_decision"."authority" IN ('legacy', 'canonical') AND "approval_deputy_decision"."decision" IN ('approved', 'rejected') AND "approval_deputy_decision"."deputy_employee_id" <> "approval_deputy_decision"."acting_for_employee_id" AND ("approval_deputy_decision"."authority" = 'legacy' OR ("approval_deputy_decision"."workflow_id" IS NOT NULL AND "approval_deputy_decision"."assignment_id" IS NOT NULL)))
);--> statement-breakpoint
ALTER TABLE "approval_deputy_decision" ADD CONSTRAINT "approval_deputy_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_deputy_decision" ADD CONSTRAINT "approval_deputy_decision_deputy_fk" FOREIGN KEY ("deputy_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_deputy_decision" ADD CONSTRAINT "approval_deputy_decision_acting_for_fk" FOREIGN KEY ("acting_for_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_deputy_decision" ADD CONSTRAINT "approval_deputy_decision_absence_fk" FOREIGN KEY ("absence_id","organization_id") REFERENCES "public"."absence_entry"("id","organization_id") ON DELETE SET NULL ("absence_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalDeputyDecision_org_assignment_idx" ON "approval_deputy_decision" USING btree ("organization_id","assignment_id") WHERE "approval_deputy_decision"."assignment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalDeputyDecision_org_legacyRequest_idx" ON "approval_deputy_decision" USING btree ("organization_id","approval_request_id") WHERE "approval_deputy_decision"."authority" = 'legacy';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeputyDecision_org_actingFor_decidedAt_idx" ON "approval_deputy_decision" USING btree ("organization_id","acting_for_employee_id","decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeputyDecision_org_absence_idx" ON "approval_deputy_decision" USING btree ("organization_id","absence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeputyDecision_org_entity_idx" ON "approval_deputy_decision" USING btree ("organization_id","entity_type","entity_id");
