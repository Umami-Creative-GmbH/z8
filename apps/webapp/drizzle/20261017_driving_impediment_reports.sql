CREATE TABLE "driving_impediment_report" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
 "employee_id" uuid NOT NULL,
 "employment_period_id" uuid,
 "command_id" uuid NOT NULL,
 "scope" text DEFAULT 'person' NOT NULL,
 "reported_at" timestamp with time zone NOT NULL,
 "reporter_user_id" text NOT NULL,
 "retention_started_at" timestamp with time zone,
 "resolved_at" timestamp with time zone,
 "resolved_by_user_id" text,
 "resolution_check_id" uuid,
 CONSTRAINT "driving_impediment_command" UNIQUE("organization_id","command_id"),
 CONSTRAINT "driving_impediment_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "employee"("id","organization_id") ON DELETE cascade,
 CONSTRAINT "driving_impediment_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "employee_employment_period"("id","organization_id","employee_id"),
 CONSTRAINT "driving_impediment_person_scope" CHECK ("scope"='person'),
 CONSTRAINT "driving_impediment_resolution" CHECK (("resolved_at" IS NULL AND "resolved_by_user_id" IS NULL AND "resolution_check_id" IS NULL) OR ("resolved_at" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL AND "resolution_check_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "driving_impediment_unresolved" ON "driving_impediment_report" ("organization_id","employee_id","reported_at") WHERE "resolved_at" IS NULL;
