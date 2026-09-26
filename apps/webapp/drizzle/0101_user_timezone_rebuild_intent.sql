-- #312: user timezone changes record one balance-rebuild intent per affected adopted
-- organization, scoped to that user's employees. Additive: organization intents keep
-- a null user and existing rows satisfy the new scope check. A user intent cascades
-- with its user and its organization.
ALTER TABLE "work_balance_rebuild_intent" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" ADD CONSTRAINT "work_balance_rebuild_intent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" DROP CONSTRAINT "work_balance_rebuild_intent_reason_check";--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" ADD CONSTRAINT "work_balance_rebuild_intent_reason_check" CHECK ("work_balance_rebuild_intent"."reason" IN ('organization_timezone', 'user_timezone'));--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" ADD CONSTRAINT "work_balance_rebuild_intent_scope_check" CHECK (("work_balance_rebuild_intent"."reason" = 'user_timezone') = ("work_balance_rebuild_intent"."user_id" IS NOT NULL));
