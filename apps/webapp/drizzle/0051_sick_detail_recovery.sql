DO $$
BEGIN
	CREATE TYPE "sick_detail" AS ENUM ('child_sick', 'with_certificate', 'without_certificate', 'other');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "absence_entry" ADD COLUMN IF NOT EXISTS "sick_detail" "sick_detail";
