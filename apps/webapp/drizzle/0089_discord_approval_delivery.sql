-- #292: Discord approval cards join the reviewed-decision and delivery owners.
-- Additive and inactive: no approval_presentation_control or
-- approval_delivery_control rows are created, so every organization keeps the
-- existing review-only Discord path.
ALTER TABLE "approval_invocation" DROP CONSTRAINT "approval_invocation_scheme_check";--> statement-breakpoint
ALTER TABLE "approval_invocation" ADD CONSTRAINT "approval_invocation_scheme_check" CHECK ("scheme" IN ('telegram_callback_query', 'discord_interaction') AND "scheme_version" = 1);--> statement-breakpoint
ALTER TABLE "approval_delivery_control" DROP CONSTRAINT "approval_delivery_control_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_control" ADD CONSTRAINT "approval_delivery_control_provider_check" CHECK ("provider" IN ('telegram', 'discord'));--> statement-breakpoint
ALTER TABLE "approval_delivery_message" DROP CONSTRAINT "approval_delivery_message_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_provider_check" CHECK ("provider" IN ('telegram', 'discord'));--> statement-breakpoint
ALTER TABLE "approval_delivery_work" DROP CONSTRAINT "approval_delivery_work_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_provider_check" CHECK ("provider" IN ('telegram', 'discord'));
