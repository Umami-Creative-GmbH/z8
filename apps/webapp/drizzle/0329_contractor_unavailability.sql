-- #1996 (spec #1935): an External Contractor's calendar unavailability. An organization that wants
-- contractors' unavailability on its team calendars creates an absence category of this type. Its
-- absences never draw on vacation or the work balance, never require work time, and are never
-- payroll absences.
--
-- A value added with ALTER TYPE ... ADD VALUE cannot be used before its transaction commits, and
-- every pending migration runs in one transaction, so the check below would fail. As in 0195,
-- absence_category.type is the type's only user: recreate the type with the new value instead,
-- whose values are usable at once.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
		WHERE t.typname = 'absence_type' AND e.enumlabel = 'contractor_unavailability'
	) THEN
		CREATE TYPE "public"."absence_type_1996" AS ENUM('home_office', 'sick', 'vacation', 'personal', 'unpaid', 'parental', 'bereavement', 'custom', 'time_off_in_lieu', 'contractor_unavailability');
		ALTER TABLE "absence_category" ALTER COLUMN "type" TYPE "public"."absence_type_1996" USING "type"::text::"public"."absence_type_1996";
		DROP TYPE "public"."absence_type";
		ALTER TYPE "public"."absence_type_1996" RENAME TO "absence_type";
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "absence_category" DROP CONSTRAINT IF EXISTS "absence_category_contractor_unavailability_check";
--> statement-breakpoint
ALTER TABLE "absence_category" ADD CONSTRAINT "absence_category_contractor_unavailability_check" CHECK ("type" <> 'contractor_unavailability' OR (NOT "counts_against_vacation" AND NOT "draws_on_work_balance" AND NOT "requires_work_time"));
