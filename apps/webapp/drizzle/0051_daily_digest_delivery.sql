CREATE TABLE IF NOT EXISTS "daily_digest_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"recipient_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"platform" text NOT NULL,
	"type" text NOT NULL,
	"recipient_local_date" date NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL CHECK ("status" IN ('processing', 'sent', 'failed')),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "dailyDigestDelivery_recipient_date_unique_idx"
	ON "daily_digest_delivery" USING btree ("organization_id", "recipient_user_id", "platform", "type", "recipient_local_date");
CREATE INDEX IF NOT EXISTS "dailyDigestDelivery_organization_status_idx"
	ON "daily_digest_delivery" USING btree ("organization_id", "status");
