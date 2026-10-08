-- Expense officer grants (#747, ADR 0001): finance access to approved expense
-- reports for someone who is not an owner or admin, scoped like payroll access
-- to all employees or to named employees and teams. Reading is always included;
-- exporting and recording reimbursements are separate capabilities. Teams are
-- matched against the teams a report recorded at approval (0135, ADR 0002).
-- At most one active grant per officer; a revoked grant stays inactive.
CREATE TABLE "expense_officer_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"officer_employee_id" uuid NOT NULL,
	"scope" text DEFAULT 'specific' NOT NULL,
	"can_export" boolean DEFAULT false NOT NULL,
	"can_record_reimbursements" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "expenseOfficerGrant_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "expense_officer_grant_scope_check" CHECK ("expense_officer_grant"."scope" in ('all', 'specific'))
);
--> statement-breakpoint
CREATE TABLE "expense_officer_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_officer_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_officer_grant" ADD CONSTRAINT "expense_officer_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_grant" ADD CONSTRAINT "expense_officer_grant_officer_fk" FOREIGN KEY ("officer_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_grant" ADD CONSTRAINT "expense_officer_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_grant" ADD CONSTRAINT "expense_officer_grant_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_team" ADD CONSTRAINT "expense_officer_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_team" ADD CONSTRAINT "expense_officer_team_grant_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."expense_officer_grant"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_team" ADD CONSTRAINT "expense_officer_team_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_team" ADD CONSTRAINT "expense_officer_team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_employee" ADD CONSTRAINT "expense_officer_employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_employee" ADD CONSTRAINT "expense_officer_employee_grant_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."expense_officer_grant"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_employee" ADD CONSTRAINT "expense_officer_employee_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_officer_employee" ADD CONSTRAINT "expense_officer_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenseOfficerGrant_organizationId_idx" ON "expense_officer_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expenseOfficerGrant_officerEmployeeId_idx" ON "expense_officer_grant" USING btree ("officer_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenseOfficerGrant_active_officer_idx" ON "expense_officer_grant" USING btree ("organization_id","officer_employee_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "expenseOfficerTeam_organizationId_idx" ON "expense_officer_team" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expenseOfficerTeam_teamId_idx" ON "expense_officer_team" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenseOfficerTeam_grant_team_idx" ON "expense_officer_team" USING btree ("grant_id","team_id");--> statement-breakpoint
CREATE INDEX "expenseOfficerEmployee_organizationId_idx" ON "expense_officer_employee" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expenseOfficerEmployee_employeeId_idx" ON "expense_officer_employee" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenseOfficerEmployee_grant_employee_idx" ON "expense_officer_employee" USING btree ("grant_id","employee_id");
