-- #300: escalation replacement delivery. Additive and inactive: replacement cards are
-- planned only from committed transfer events in organizations with a delivery control.
-- A `replacement` effect sends the card of an escalation's replacement assignment; work
-- linked to a transfer is executed by escalation, all other work by the delivery owner.
ALTER TABLE "approval_delivery_work" ADD COLUMN "escalation_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_escalation_transfer_fk" FOREIGN KEY ("escalation_transfer_id","organization_id") REFERENCES "approval_escalation_transfer"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" DROP CONSTRAINT "approval_delivery_work_effect_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_effect_check" CHECK (("effect" = 'initial' AND "message_id" IS NULL AND "escalation_transfer_id" IS NULL) OR ("effect" = 'replacement' AND "message_id" IS NULL AND "escalation_transfer_id" IS NOT NULL) OR ("effect" = 'refresh' AND "message_id" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "approvalDeliveryWork_org_transfer_idx" ON "approval_delivery_work" USING btree ("organization_id","escalation_transfer_id") WHERE "escalation_transfer_id" IS NOT NULL;
