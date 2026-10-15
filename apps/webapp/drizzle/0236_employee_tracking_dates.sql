CREATE TABLE "employee_tracking_settings" (
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "tracking_start_date" date,
 "revision" integer DEFAULT 1 NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 CONSTRAINT "employee_tracking_settings_pkey" PRIMARY KEY ("organization_id", "employee_id"),
 CONSTRAINT "employee_tracking_settings_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
 CONSTRAINT "employee_tracking_settings_revision_check" CHECK ("revision" >= 1)
);
