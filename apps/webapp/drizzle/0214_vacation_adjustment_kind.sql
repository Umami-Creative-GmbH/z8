-- Vacation adjustment kind (#1106): the monthly/biweekly accrual job's rows become `accrual`, every
-- other row stays `manual`. An accrual policy's balance starts at 0 and grows through its accrual
-- rows, and the admin page lists only manual adjustments. The job always wrote the reason
-- "Monthly accrual for <month>: +x days", biweekly policies included, so that prefix identifies
-- its rows. Accrual rows are written by the system, so `adjusted_by` becomes nullable for them.
ALTER TABLE "vacation_adjustment" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE "vacation_adjustment" SET "kind" = 'accrual' WHERE "kind" = 'manual' AND "reason" LIKE 'Monthly accrual for %';--> statement-breakpoint
ALTER TABLE "vacation_adjustment" ALTER COLUMN "adjusted_by" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_kind_check" CHECK ("vacation_adjustment"."kind" IN ('manual', 'accrual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_manual_adjuster_check" CHECK ("vacation_adjustment"."kind" = 'accrual' OR "vacation_adjustment"."adjusted_by" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
