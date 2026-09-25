-- #294: Slack joins the approval delivery owner (#291). Additive and inactive: no
-- approval_delivery_control row admits 'slack' until activation. Slack cards stay
-- review-only; nothing here admits Slack actions (approval_presentation_control).
ALTER TABLE "approval_delivery_control" DROP CONSTRAINT "approval_delivery_control_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_control" ADD CONSTRAINT "approval_delivery_control_provider_check" CHECK ("approval_delivery_control"."provider" IN ('telegram', 'slack'));--> statement-breakpoint
ALTER TABLE "approval_delivery_message" DROP CONSTRAINT "approval_delivery_message_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_provider_check" CHECK ("approval_delivery_message"."provider" IN ('telegram', 'slack'));--> statement-breakpoint
ALTER TABLE "approval_delivery_work" DROP CONSTRAINT "approval_delivery_work_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_provider_check" CHECK ("approval_delivery_work"."provider" IN ('telegram', 'slack'));
