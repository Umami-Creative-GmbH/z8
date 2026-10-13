-- Vacation adjustment kind (#1106): the monthly/biweekly accrual job's rows become `accrual`, every
-- other row stays `manual`. An accrual policy's balance starts at 0 and grows through its accrual
-- rows, and the admin page lists only manual adjustments. The job always wrote the reason
-- "Monthly accrual for <month>: +x days", biweekly policies included, so that prefix identifies
-- its rows. Accrual rows are written by the system, so `adjusted_by` becomes nullable for them.
--
-- Each accrual row covers one calendar month (`accrual_month`) of its `year`. A unique index on
-- (employee, year, month) for accrual rows makes the job idempotent: a retry or a catch-up skips
-- months already accrued. Existing accrual rows get the month named in their reason. When a retry
-- once wrote a month twice, only the earliest row gets the month, so the index never fails; the
-- later duplicate keeps a null month and stays an accrual row.
ALTER TABLE "vacation_adjustment" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_adjustment" ADD COLUMN IF NOT EXISTS "accrual_month" integer;--> statement-breakpoint
UPDATE "vacation_adjustment" SET "kind" = 'accrual' WHERE "kind" = 'manual' AND "reason" LIKE 'Monthly accrual for %';--> statement-breakpoint
WITH "named" AS (
	SELECT
		"id",
		array_position(
			ARRAY['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']::text[],
			substring("reason" FROM '^Monthly accrual for ([A-Za-z]+) ')
		) AS "month",
		"employee_id",
		"year",
		"created_at"
	FROM "vacation_adjustment"
	WHERE "kind" = 'accrual' AND "accrual_month" IS NULL
), "ranked" AS (
	SELECT
		"id",
		"month",
		row_number() OVER (PARTITION BY "employee_id", "year", "month" ORDER BY "created_at", "id") AS "position"
	FROM "named"
	WHERE "month" IS NOT NULL
)
UPDATE "vacation_adjustment" SET "accrual_month" = "ranked"."month"
FROM "ranked"
WHERE "vacation_adjustment"."id" = "ranked"."id"
	AND "ranked"."position" = 1
	AND NOT EXISTS (
		SELECT 1 FROM "vacation_adjustment" AS "existing"
		WHERE "existing"."employee_id" = "vacation_adjustment"."employee_id"
			AND "existing"."year" = "vacation_adjustment"."year"
			AND "existing"."kind" = 'accrual'
			AND "existing"."accrual_month" = "ranked"."month"
	);--> statement-breakpoint
ALTER TABLE "vacation_adjustment" ALTER COLUMN "adjusted_by" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_kind_check" CHECK ("vacation_adjustment"."kind" IN ('manual', 'accrual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_manual_adjuster_check" CHECK ("vacation_adjustment"."kind" = 'accrual' OR "vacation_adjustment"."adjusted_by" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_accrual_month_check" CHECK ("vacation_adjustment"."accrual_month" IS NULL OR ("vacation_adjustment"."kind" = 'accrual' AND "vacation_adjustment"."accrual_month" BETWEEN 1 AND 12));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacationAdjustment_accrual_period_idx" ON "vacation_adjustment" USING btree ("employee_id","year","accrual_month") WHERE "vacation_adjustment"."kind" = 'accrual';
