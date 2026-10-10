-- Deputy approval cards (#1017, spec #802, Approvals ADR 0002). While a deputy
-- covers for an absent approver, new approvals assigned to that approver also
-- send the deputy a card. The work, the delivered message and the card's review
-- binding name the absent approver the deputy acts for, so the card is bound to
-- the deputy and to the approver's assignment, refuses once cover ends, and is
-- retired then. Null everywhere else (the approver's own cards).
ALTER TABLE "approval_delivery_work" ADD COLUMN IF NOT EXISTS "acting_for_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD COLUMN IF NOT EXISTS "acting_for_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ADD COLUMN IF NOT EXISTS "acting_for_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_acting_for_fk" FOREIGN KEY ("acting_for_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_acting_for_fk" FOREIGN KEY ("acting_for_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ADD CONSTRAINT "approval_review_binding_acting_for_fk" FOREIGN KEY ("acting_for_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The retirement pass scans an organization's open deputy cards.
CREATE INDEX IF NOT EXISTS "approvalDeliveryMessage_org_acting_for_idx" ON "approval_delivery_message" USING btree ("organization_id","acting_for_employee_id","recipient_employee_id") WHERE "approval_delivery_message"."acting_for_employee_id" IS NOT NULL AND "approval_delivery_message"."state" = 'current';
