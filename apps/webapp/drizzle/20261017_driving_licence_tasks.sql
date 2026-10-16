CREATE TABLE "driving_licence_task" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "employment_period_id" uuid,
 "occasion_key" text NOT NULL,
 "kind" text NOT NULL CHECK ("kind" IN ('personal_reminder','reassignment')),
 "state" text DEFAULT 'pending' NOT NULL CHECK ("state" IN ('pending','completed','obsolete')),
 "generation" integer DEFAULT 1 NOT NULL,
 "created_at" timestamp with time zone NOT NULL,
 "completed_at" timestamp with time zone,
 "completed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 CONSTRAINT "driving_task_employee_org_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "employee"("id","organization_id") ON DELETE CASCADE,
 CONSTRAINT "driving_task_employment_org_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "employee_employment_period"("id","organization_id","employee_id"),
 CONSTRAINT "driving_task_occasion" UNIQUE ("organization_id","kind","occasion_key")
);
--> statement-breakpoint
CREATE INDEX "driving_task_org_employee" ON "driving_licence_task" ("organization_id","employee_id");
