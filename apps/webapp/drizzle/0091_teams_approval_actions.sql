-- #293: Teams Universal Action invocations (scoped recorded activity IDs) and
-- Teams cards in the approval delivery owner. Additive and inactive: no
-- presentation or delivery control rows are inserted. The provider checks keep
-- every provider admitted so far (#291 Telegram, #294 Slack); a later migration
-- must keep this union too.
ALTER TABLE "approval_invocation" DROP CONSTRAINT "approval_invocation_scheme_check";--> statement-breakpoint
ALTER TABLE "approval_invocation" ADD CONSTRAINT "approval_invocation_scheme_check" CHECK ("scheme" IN ('telegram_callback_query', 'teams_adaptive_card_action') AND "scheme_version" = 1);--> statement-breakpoint
ALTER TABLE "approval_delivery_control" DROP CONSTRAINT "approval_delivery_control_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_control" ADD CONSTRAINT "approval_delivery_control_provider_check" CHECK ("provider" IN ('telegram', 'teams', 'slack'));--> statement-breakpoint
ALTER TABLE "approval_delivery_message" DROP CONSTRAINT "approval_delivery_message_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_provider_check" CHECK ("provider" IN ('telegram', 'teams', 'slack'));--> statement-breakpoint
ALTER TABLE "approval_delivery_work" DROP CONSTRAINT "approval_delivery_work_provider_check";--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_provider_check" CHECK ("provider" IN ('telegram', 'teams', 'slack'));
