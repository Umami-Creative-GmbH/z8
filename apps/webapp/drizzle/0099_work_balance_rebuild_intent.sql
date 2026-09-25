-- #311: durable balance-rebuild intent committed with an organization timezone change.
-- Additive: only organizations whose append control is active record intents, so
-- nothing changes until activation. Rows are deleted when the rebuild completes and
-- cascade with their organization.
CREATE TABLE "work_balance_rebuild_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "work_balance_rebuild_intent_reason_check" CHECK ("work_balance_rebuild_intent"."reason" IN ('organization_timezone'))
);
--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" ADD CONSTRAINT "work_balance_rebuild_intent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" ADD CONSTRAINT "work_balance_rebuild_intent_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workBalanceRebuildIntent_org_requested_idx" ON "work_balance_rebuild_intent" USING btree ("organization_id","requested_at");
