CREATE TABLE IF NOT EXISTS "telegram_digest_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_employee_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"platform" text NOT NULL,
	"digest_type" text NOT NULL,
	"logical_date" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"failed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_digest_delivery_status_check" CHECK ("status" IN ('sending', 'sent', 'failed'))
);

DO $$ BEGIN
	ALTER TABLE "telegram_digest_delivery" ADD CONSTRAINT "telegram_digest_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "telegram_digest_delivery" ADD CONSTRAINT "telegram_digest_delivery_recipient_employee_id_employee_id_fk" FOREIGN KEY ("recipient_employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "telegram_digest_delivery" ADD CONSTRAINT "telegram_digest_delivery_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "telegramDigestDelivery_idempotency_unique_idx" ON "telegram_digest_delivery" USING btree ("organization_id", "recipient_employee_id", "recipient_user_id", "platform", "digest_type", "logical_date");
CREATE INDEX IF NOT EXISTS "telegramDigestDelivery_organizationId_idx" ON "telegram_digest_delivery" USING btree ("organization_id");
