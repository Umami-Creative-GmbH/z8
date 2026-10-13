-- Vacation policy proration settings (#1109, spec #1104 rules 4 and 6). Every policy, existing
-- and new, prorates in start and exit years by default. The statutory minimum is the floor of
-- the prorated allowance; existing policies get min(20, default_annual_days). New policies get
-- the same default from the application (defaultStatutoryMinimumDays), since a column default
-- cannot read another column.
ALTER TABLE "vacation_allowance" ADD COLUMN IF NOT EXISTS "prorate_in_start_and_exit_year" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ADD COLUMN IF NOT EXISTS "statutory_minimum_days" numeric;--> statement-breakpoint
UPDATE "vacation_allowance" SET "statutory_minimum_days" = LEAST(20, "default_annual_days") WHERE "statutory_minimum_days" IS NULL;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ALTER COLUMN "statutory_minimum_days" SET NOT NULL;
