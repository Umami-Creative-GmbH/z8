-- #384: legacy-authoritative absence cards and cycle-keyed legacy delivery.
-- Additive and inactive: no evidence, presentation or delivery control row is
-- inserted, so every organization keeps its current (review-only or unsent)
-- absence cards.
--
-- A legacy delivery lifecycle may now be one submission cycle: the legacy
-- chain instance, or the single legacy request, that one submission created.
-- Rows without a cycle keep the source-scoped lifecycle (expense claims).
ALTER TABLE "approval_delivery_intent" ADD COLUMN "legacy_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD COLUMN "legacy_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD COLUMN "legacy_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_legacy_cycle_check" CHECK ("legacy_cycle_id" IS NULL OR "lifecycle" = 'legacy');--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_legacy_cycle_check" CHECK ("legacy_cycle_id" IS NULL OR "lifecycle" = 'legacy');--> statement-breakpoint
CREATE INDEX "approvalDeliveryIntent_org_legacy_cycle_idx" ON "approval_delivery_intent" USING btree ("organization_id","legacy_cycle_id") WHERE "legacy_cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "approvalDeliveryWork_org_legacy_cycle_idx" ON "approval_delivery_work" USING btree ("organization_id","legacy_cycle_id") WHERE "legacy_cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "approvalDeliveryMessage_org_legacy_cycle_idx" ON "approval_delivery_message" USING btree ("organization_id","legacy_cycle_id") WHERE "legacy_cycle_id" IS NOT NULL;--> statement-breakpoint
-- Ordinary absence cancellation deletes pending legacy requests. Delivery rows
-- keep the request by value, like legacy evidence, so a cancelled cycle's sent
-- cards can still be refreshed ("withdrawn") and are purged only by privileged
-- cleanup, which deletes them explicitly and reports them.
ALTER TABLE "approval_delivery_intent" DROP CONSTRAINT "approval_delivery_intent_legacy_request_fk";--> statement-breakpoint
ALTER TABLE "approval_delivery_work" DROP CONSTRAINT "approval_delivery_work_legacy_request_fk";--> statement-breakpoint
ALTER TABLE "approval_delivery_message" DROP CONSTRAINT "approval_delivery_message_legacy_request_fk";--> statement-breakpoint
-- Cancellation of a cycle is a lifecycle intent of its own.
ALTER TABLE "approval_delivery_intent" DROP CONSTRAINT "approval_delivery_intent_event_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_intent" ADD CONSTRAINT "approval_delivery_intent_event_check" CHECK ("event" IN ('submitted', 'decided', 'withdrawn'));--> statement-breakpoint
ALTER TABLE "approval_delivery_intent" ADD CONSTRAINT "approval_delivery_intent_withdrawn_cycle_check" CHECK ("event" <> 'withdrawn' OR "legacy_cycle_id" IS NOT NULL);
