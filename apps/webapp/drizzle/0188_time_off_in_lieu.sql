-- #1000: time off in lieu. An absence category can draw on the work balance: its approved
-- absences keep their days' required time, so the work balance falls by it. It is never
-- combined with "counts against vacation" or "requires work time".
ALTER TABLE "absence_category" ADD COLUMN IF NOT EXISTS "draws_on_work_balance" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "absence_category" DROP CONSTRAINT IF EXISTS "absence_category_draws_on_work_balance_check";
--> statement-breakpoint
ALTER TABLE "absence_category" ADD CONSTRAINT "absence_category_draws_on_work_balance_check" CHECK (NOT "draws_on_work_balance" OR (NOT "counts_against_vacation" AND NOT "requires_work_time"));
--> statement-breakpoint
-- The built-in category's type. A value added with ALTER TYPE ... ADD VALUE cannot be used
-- before its transaction commits, and every pending migration runs in one transaction, so
-- the seeding below would fail. absence_category.type is the type's only user: recreate the
-- type with the new value instead, whose values are usable at once.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
		WHERE t.typname = 'absence_type' AND e.enumlabel = 'time_off_in_lieu'
	) THEN
		CREATE TYPE "public"."absence_type_1000" AS ENUM('home_office', 'sick', 'vacation', 'personal', 'unpaid', 'parental', 'bereavement', 'custom', 'time_off_in_lieu');
		ALTER TABLE "absence_category" ALTER COLUMN "type" TYPE "public"."absence_type_1000" USING "type"::text::"public"."absence_type_1000";
		DROP TYPE "public"."absence_type";
		ALTER TYPE "public"."absence_type_1000" RENAME TO "absence_type";
	END IF;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'time_off_in_lieu_available';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "absence_category_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	CONSTRAINT "absenceCategoryNotice_categoryId_unique" UNIQUE("category_id"),
	CONSTRAINT "absence_category_notice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "absence_category_notice_category_id_absence_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."absence_category"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absenceCategoryNotice_pending_idx" ON "absence_category_notice" USING btree ("created_at") WHERE delivered_at IS NULL;
--> statement-breakpoint
-- Organizations that exist now get the built-in category inactive, and their owners and
-- admins one notice that it is available. New organizations get it active with the other
-- built-in categories.
WITH seeded AS (
	INSERT INTO "absence_category" (
		"organization_id", "type", "name", "description", "requires_work_time", "requires_approval",
		"counts_against_vacation", "draws_on_work_balance", "color", "is_active", "updated_at"
	)
	SELECT o."id", 'time_off_in_lieu', 'Time off in lieu', 'Time off taken against the work balance',
		false, true, false, true, '#14b8a6', false, now()
	FROM "organization" o
	WHERE NOT EXISTS (
		SELECT 1 FROM "absence_category" c
		WHERE c."organization_id" = o."id" AND c."type" = 'time_off_in_lieu'
	)
	RETURNING "id", "organization_id"
)
INSERT INTO "absence_category_notice" ("organization_id", "category_id")
SELECT "organization_id", "id" FROM seeded
ON CONFLICT DO NOTHING;
