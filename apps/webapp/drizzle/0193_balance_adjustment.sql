-- #993 (spec #804, Time Tracking ADR-0008): balance adjustments, the insert-only
-- and cancellable ledger of opening balances and overtime payouts. The
-- work-balance projection reads the uncancelled ones each time it is computed;
-- employee_work_balance.adjustment_minutes records what it counted.
DO $$ BEGIN
	CREATE TYPE "public"."balance_adjustment_kind" AS ENUM('opening_balance', 'overtime_payout');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "balance_adjustment_kind" NOT NULL,
	"day" date NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancellation_reason" text,
	CONSTRAINT "balance_adjustment_reason_check" CHECK (length(btrim("reason")) > 0),
	CONSTRAINT "balance_adjustment_payout_minutes_check" CHECK ("kind" <> 'overtime_payout' OR "minutes" < 0),
	CONSTRAINT "balance_adjustment_cancellation_check" CHECK (("cancelled_at" IS NULL) = ("cancellation_reason" IS NULL) AND ("cancelled_at" IS NOT NULL OR "cancelled_by" IS NULL) AND ("cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) > 0))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "balance_adjustment" ADD CONSTRAINT "balance_adjustment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "balance_adjustment" ADD CONSTRAINT "balance_adjustment_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "balance_adjustment" ADD CONSTRAINT "balance_adjustment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "balance_adjustment" ADD CONSTRAINT "balance_adjustment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balanceAdjustment_org_employee_day_idx" ON "balance_adjustment" USING btree ("organization_id","employee_id","day");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "balanceAdjustment_open_opening_balance_idx" ON "balance_adjustment" USING btree ("organization_id","employee_id") WHERE "balance_adjustment"."kind" = 'opening_balance' AND "balance_adjustment"."cancelled_at" IS NULL;
--> statement-breakpoint
-- Insert-only: the only update is the one cancellation (and the foreign keys
-- clearing a deleted user); the only delete is the cascade from an erased
-- employee or organization.
CREATE OR REPLACE FUNCTION "balance_adjustment_guard_insert_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF NOT EXISTS (SELECT 1 FROM public."organization" WHERE "id" = OLD.organization_id)
			OR NOT EXISTS (
				SELECT 1 FROM public."employee"
				WHERE "id" = OLD.employee_id AND "organization_id" = OLD.organization_id
			)
		THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION USING
			ERRCODE = '55000',
			MESSAGE = 'Balance adjustments are never deleted; cancel them instead';
	END IF;

	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
		OR NEW.kind IS DISTINCT FROM OLD.kind
		OR NEW.day IS DISTINCT FROM OLD.day
		OR NEW.minutes IS DISTINCT FROM OLD.minutes
		OR NEW.reason IS DISTINCT FROM OLD.reason
		OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
		OR (NEW.recorded_by IS DISTINCT FROM OLD.recorded_by AND NEW.recorded_by IS NOT NULL)
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '55000',
			MESSAGE = 'Balance adjustments are never edited; cancel them instead';
	END IF;

	IF OLD.cancelled_at IS NULL THEN
		-- Recording the cancellation (or leaving the row uncancelled).
		RETURN NEW;
	END IF;

	IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
		OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
		OR (NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by AND NEW.cancelled_by IS NOT NULL)
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '55000',
			MESSAGE = 'A balance adjustment is cancelled only once';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "balance_adjustment_guard_insert_only_trigger" ON "balance_adjustment";
--> statement-breakpoint
CREATE TRIGGER "balance_adjustment_guard_insert_only_trigger"
	BEFORE UPDATE OR DELETE ON "balance_adjustment"
	FOR EACH ROW EXECUTE FUNCTION "balance_adjustment_guard_insert_only"();
--> statement-breakpoint
ALTER TABLE "employee_work_balance" ADD COLUMN IF NOT EXISTS "adjustment_minutes" integer DEFAULT 0 NOT NULL;
