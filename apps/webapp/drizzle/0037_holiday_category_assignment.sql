CREATE TABLE IF NOT EXISTS "holiday_category_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "holiday_category_assignment_category_id_holiday_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "holiday_category_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_categoryId_idx" ON "holiday_category_assignment" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_organizationId_idx" ON "holiday_category_assignment" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_teamId_idx" ON "holiday_category_assignment" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holidayCategoryAssignment_employeeId_idx" ON "holiday_category_assignment" USING btree ("employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "holidayCategoryAssignment_category_org_idx" ON "holiday_category_assignment" USING btree ("category_id", "organization_id", "assignment_type") WHERE assignment_type = 'organization' AND is_active = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "holidayCategoryAssignment_category_team_idx" ON "holiday_category_assignment" USING btree ("category_id", "team_id") WHERE team_id IS NOT NULL AND is_active = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "holidayCategoryAssignment_category_employee_idx" ON "holiday_category_assignment" USING btree ("category_id", "employee_id") WHERE employee_id IS NOT NULL AND is_active = true;
