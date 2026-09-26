-- #408: replacement cards and "Reassigned" retirement for legacy-authoritative
-- escalation transfers (absences and travel expenses). Additive and inactive: no
-- delivery or escalation control row is inserted, so nothing is delivered until an
-- organization has a delivery control for the kind.
--
-- A legacy transfer moves the same legacy request to its replacement, so the
-- lifecycle's version would not change. Escalation's replacement pass records the
-- transfer as a lifecycle intent of its own (`transferred`, once per transfer), which
-- raises the lifecycle's version so the former holder's cards can be retired.
ALTER TABLE "approval_delivery_intent" ADD COLUMN "escalation_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_intent" ADD CONSTRAINT "approval_delivery_intent_escalation_transfer_fk" FOREIGN KEY ("escalation_transfer_id","organization_id") REFERENCES "approval_escalation_transfer"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approval_delivery_intent" DROP CONSTRAINT "approval_delivery_intent_event_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_intent" ADD CONSTRAINT "approval_delivery_intent_event_check" CHECK ("event" IN ('submitted', 'decided', 'withdrawn', 'transferred'));--> statement-breakpoint
ALTER TABLE "approval_delivery_intent" ADD CONSTRAINT "approval_delivery_intent_transfer_check" CHECK (("event" = 'transferred') = ("escalation_transfer_id" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "approvalDeliveryIntent_org_transfer_idx" ON "approval_delivery_intent" USING btree ("organization_id","escalation_transfer_id") WHERE "escalation_transfer_id" IS NOT NULL;
