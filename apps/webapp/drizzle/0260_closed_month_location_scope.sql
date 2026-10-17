-- Location closes (#836, Time Tracking ADR-0004): a close may cover the employees assigned
-- to one location when it is closed. The close keeps the location's id and its name at
-- close, so history stays readable after the location is renamed or deleted; no foreign
-- key, as with a team close's team.
ALTER TABLE "closed_month" ADD COLUMN "location_id" uuid;
--> statement-breakpoint
ALTER TABLE "closed_month" ADD COLUMN "location_name" text;
--> statement-breakpoint
ALTER TABLE "closed_month" DROP CONSTRAINT "closed_month_scope_check";
--> statement-breakpoint
ALTER TABLE "closed_month" ADD CONSTRAINT "closed_month_scope_check" CHECK (("closed_month"."scope" = 'organization' AND "closed_month"."team_id" IS NULL AND "closed_month"."location_id" IS NULL AND "closed_month"."location_name" IS NULL) OR ("closed_month"."scope" = 'team' AND "closed_month"."team_id" IS NOT NULL AND "closed_month"."location_id" IS NULL AND "closed_month"."location_name" IS NULL AND NOT "closed_month"."covers_new_employees") OR ("closed_month"."scope" = 'location' AND "closed_month"."location_id" IS NOT NULL AND "closed_month"."location_name" IS NOT NULL AND "closed_month"."team_id" IS NULL AND NOT "closed_month"."covers_new_employees"));
