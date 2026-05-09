ALTER TABLE "user_settings"
ADD COLUMN IF NOT EXISTS "time_format" text DEFAULT '24h' NOT NULL;
