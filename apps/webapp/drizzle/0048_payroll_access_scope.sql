ALTER TABLE "payroll_access_grant"
	ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'specific' NOT NULL;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant"
		ADD CONSTRAINT "payroll_access_grant_scope_check" CHECK ("scope" IN ('all', 'specific'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
