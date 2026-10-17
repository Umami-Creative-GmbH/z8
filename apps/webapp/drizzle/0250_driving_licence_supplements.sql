CREATE TABLE "driving_licence_supplement" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "check_id" uuid NOT NULL,
 "command_id" uuid NOT NULL,
 "author_employee_id" uuid NOT NULL,
 "author_user_id" text NOT NULL REFERENCES "user"("id"),
 "author_name" text NOT NULL,
 "recorded_at" timestamp with time zone NOT NULL,
 "reason" text NOT NULL CONSTRAINT "driving_supplement_reason" CHECK ("reason" IN ('recording_error','missing_detail')),
 "correction" jsonb NOT NULL,
 CONSTRAINT "driving_supplement_command" UNIQUE ("organization_id", "command_id"),
 CONSTRAINT "driving_supplement_check" FOREIGN KEY ("organization_id", "check_id") REFERENCES "driving_licence_check"("organization_id", "id") ON DELETE CASCADE,
 CONSTRAINT "driving_supplement_employee" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
 CONSTRAINT "driving_supplement_author" FOREIGN KEY ("author_employee_id", "organization_id") REFERENCES "employee"("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "driving_supplement_employee_time" ON "driving_licence_supplement" ("organization_id", "employee_id", "recorded_at");
--> statement-breakpoint
CREATE TRIGGER "driving_supplement_immutable" BEFORE UPDATE ON "driving_licence_supplement" FOR EACH ROW EXECUTE FUNCTION driving_check_immutable();
