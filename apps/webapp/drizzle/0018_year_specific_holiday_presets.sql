-- Preflight: this migration adds a unique location/year preset index. Existing
-- duplicate rows for the same organization/location/year must be resolved before
-- applying it; the migration intentionally does not delete or merge data.
-- Preflight: this migration adds active assignment range exclusion constraints.
-- Existing overlapping active organization/team/employee preset assignments must
-- be resolved before applying it; the migration intentionally does no cleanup.
ALTER TABLE "holiday_preset" ADD COLUMN "year" integer;--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPreset_org_location_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPreset_org_location_year_idx" ON "holiday_preset" USING btree ("organization_id",COALESCE("country_code", ''),COALESCE("state_code", ''),COALESCE("region_code", ''),COALESCE("year", 0));--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPresetAssignment_org_default_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPresetAssignment_team_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "holidayPresetAssignment_employee_idx";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holidayPresetAssignment_org_range_excl" EXCLUDE USING gist ("organization_id" WITH =, tsrange(COALESCE("effective_from", '-infinity'::timestamp), COALESCE("effective_until", 'infinity'::timestamp), '[]') WITH &&) WHERE ("assignment_type" = 'organization' AND "is_active" = true);--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holidayPresetAssignment_team_range_excl" EXCLUDE USING gist ("organization_id" WITH =, "team_id" WITH =, tsrange(COALESCE("effective_from", '-infinity'::timestamp), COALESCE("effective_until", 'infinity'::timestamp), '[]') WITH &&) WHERE ("assignment_type" = 'team' AND "team_id" IS NOT NULL AND "is_active" = true);--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holidayPresetAssignment_employee_range_excl" EXCLUDE USING gist ("organization_id" WITH =, "employee_id" WITH =, tsrange(COALESCE("effective_from", '-infinity'::timestamp), COALESCE("effective_until", 'infinity'::timestamp), '[]') WITH &&) WHERE ("assignment_type" = 'employee' AND "employee_id" IS NOT NULL AND "is_active" = true);
