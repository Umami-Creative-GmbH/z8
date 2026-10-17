CREATE TABLE driving_licence_policy (
 organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, interval_months integer NOT NULL,
 timezone text NOT NULL, reminder_lead_days jsonb NOT NULL,
 retention_months integer, retention_justification text,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL, updated_by text NOT NULL REFERENCES "user"(id),
 CONSTRAINT driving_licence_policy_interval CHECK(interval_months BETWEEN 1 AND 120),
 CONSTRAINT driving_licence_policy_retention CHECK(retention_months IS NULL OR retention_months BETWEEN 1 AND 120),
 CONSTRAINT driving_licence_policy_activation CHECK(NOT enabled OR (retention_months IS NOT NULL AND retention_justification IS NOT NULL AND length(trim(retention_justification)) >= 10))
);
--> statement-breakpoint
CREATE TABLE driving_licence_policy_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 version integer NOT NULL, policy jsonb NOT NULL, changed_at timestamptz NOT NULL, changed_by text NOT NULL REFERENCES "user"(id),
 CONSTRAINT driving_licence_policy_revision_version UNIQUE(organization_id,version)
);
--> statement-breakpoint
CREATE TABLE driving_licence_participant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL, enrolled_at timestamptz NOT NULL, enrolled_by text NOT NULL REFERENCES "user"(id),
 CONSTRAINT driving_licence_participant_employee UNIQUE(organization_id,employee_id),
 FOREIGN KEY(employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE
);
