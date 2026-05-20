DROP INDEX IF EXISTS "subscription_stripe_customer_id_idx";

ALTER TABLE "subscription"
	ALTER COLUMN "stripe_customer_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_stripe_customer_id_idx"
	ON "subscription" ("stripe_customer_id")
	WHERE "stripe_customer_id" IS NOT NULL;
