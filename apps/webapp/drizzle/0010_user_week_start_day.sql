ALTER TABLE "user_settings"
ADD COLUMN IF NOT EXISTS "week_start_day" text DEFAULT 'sunday' NOT NULL;
