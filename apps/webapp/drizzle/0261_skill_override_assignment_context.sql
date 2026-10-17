-- #893: a skill requirement override records the assignment context it covered, so a later
-- save in the same context is not logged twice. Overrides from before #893 have none.
ALTER TABLE "skill_requirement_override" ADD COLUMN "shift_date" timestamp;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD COLUMN "subarea_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD CONSTRAINT "skill_requirement_override_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD CONSTRAINT "skill_requirement_override_template_id_shift_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_template"("id") ON DELETE set null ON UPDATE no action;
