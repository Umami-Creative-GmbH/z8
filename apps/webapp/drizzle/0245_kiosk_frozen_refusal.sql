-- #1290: frozen kiosk clock commands Z8 refused on arrival, kept once per kiosk and operation
-- (spec #885). A resend is answered from the record, the kiosk's lookup reads it, and owners and
-- admins see it in the kiosk settings. The employee, or a kiosk-only employee's managers, get a
-- kiosk_command_refused notification. An added enum value is not usable in the transaction that
-- adds it, so nothing below uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'kiosk_command_refused';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kiosk_frozen_refusal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"employee_id" uuid,
	"action" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"time_source" text NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"command" jsonb NOT NULL,
	"refused_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_frozen_refusal" ADD CONSTRAINT "kiosk_frozen_refusal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_frozen_refusal" ADD CONSTRAINT "kiosk_frozen_refusal_kiosk_fk" FOREIGN KEY ("kiosk_id","organization_id") REFERENCES "public"."kiosk"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_frozen_refusal" ADD CONSTRAINT "kiosk_frozen_refusal_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kioskFrozenRefusal_operation_idx" ON "kiosk_frozen_refusal" USING btree ("organization_id","kiosk_id","operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kioskFrozenRefusal_organization_refusedAt_idx" ON "kiosk_frozen_refusal" USING btree ("organization_id","refused_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kioskFrozenRefusal_employee_idx" ON "kiosk_frozen_refusal" USING btree ("employee_id");
