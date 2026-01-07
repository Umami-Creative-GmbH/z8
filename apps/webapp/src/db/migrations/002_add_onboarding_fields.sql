-- Add onboarding tracking fields to user table
ALTER TABLE "user"
ADD COLUMN "onboarding_complete" boolean DEFAULT false NOT NULL,
ADD COLUMN "onboarding_step" text,
ADD COLUMN "onboarding_started_at" timestamp,
ADD COLUMN "onboarding_completed_at" timestamp;

-- Set onboarding_complete = true for existing users with organizations
UPDATE "user"
SET "onboarding_complete" = true,
    "onboarding_completed_at" = NOW()
WHERE id IN (
  SELECT DISTINCT user_id
  FROM member
);

-- Set onboarding_complete = false for users without organizations
UPDATE "user"
SET "onboarding_complete" = false,
    "onboarding_step" = 'welcome'
WHERE id NOT IN (
  SELECT DISTINCT user_id
  FROM member
);
