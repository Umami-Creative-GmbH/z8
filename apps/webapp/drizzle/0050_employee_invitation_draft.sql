CREATE TABLE IF NOT EXISTS "employee_invitation_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" uuid,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"first_name" text,
	"last_name" text,
	"position" text,
	"employee_number" text,
	"gender" "gender",
	"pronouns" text,
	"birthday" timestamp,
	"start_date" timestamp,
	"end_date" timestamp,
	"contract_type" "contract_type" DEFAULT 'fixed' NOT NULL,
	"current_hourly_rate" numeric(10, 2),
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "invitation_id_organization_id_idx" ON "invitation" USING btree ("id", "organization_id");

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_invitation_org_fk" FOREIGN KEY ("invitation_id","organization_id") REFERENCES "public"."invitation"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_team_org_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE SET NULL ("team_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_invitationId_unique_idx" ON "employee_invitation_draft" USING btree ("invitation_id");
CREATE INDEX IF NOT EXISTS "employeeInvitationDraft_organizationId_idx" ON "employee_invitation_draft" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "employeeInvitationDraft_teamId_idx" ON "employee_invitation_draft" USING btree ("team_id");
