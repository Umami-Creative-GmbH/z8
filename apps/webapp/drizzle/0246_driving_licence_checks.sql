CREATE TABLE driving_licence_check (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, employee_id uuid NOT NULL, employment_period_id uuid,
 verifier_employee_id uuid NOT NULL, verifier_user_id text NOT NULL REFERENCES "user"(id), employee_name text NOT NULL, verifier_name text NOT NULL, controlled_at timestamptz NOT NULL, command_id uuid NOT NULL,
 policy_version integer NOT NULL, interval_months integer NOT NULL, deadline_timezone text NOT NULL, document_issued_on date NOT NULL, document_expires_on date NOT NULL,
 original_inspected boolean NOT NULL, identity_confirmed boolean NOT NULL, employee_declaration boolean NOT NULL, declaration_text text NOT NULL, verifier_confirmed boolean NOT NULL, classes jsonb NOT NULL, failure_scope text NOT NULL,
 CONSTRAINT driving_check_org_id UNIQUE(organization_id,id), CONSTRAINT driving_check_command UNIQUE(organization_id,command_id),
 FOREIGN KEY(employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE,
 FOREIGN KEY(verifier_employee_id,organization_id) REFERENCES employee(id,organization_id),
 FOREIGN KEY(employment_period_id,organization_id,employee_id) REFERENCES employee_employment_period(id,organization_id,employee_id),
 CONSTRAINT driving_check_not_self CHECK(employee_id <> verifier_employee_id), CONSTRAINT driving_check_confirmation CHECK(verifier_confirmed),
 CONSTRAINT driving_check_document_dates CHECK(document_issued_on <= document_expires_on), CONSTRAINT driving_check_classes CHECK(jsonb_typeof(classes)='array' AND jsonb_array_length(classes)>0)
);
--> statement-breakpoint
CREATE TABLE driving_authorization (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, employee_id uuid NOT NULL, employment_period_id uuid, class_code text NOT NULL,
 supporting_check_id uuid NOT NULL, last_successful_at timestamptz, routine_valid_through date NOT NULL, document_valid_through date NOT NULL, class_valid_through date, valid_through date NOT NULL, deadline_timezone text NOT NULL, expires_at timestamptz NOT NULL, restrictions text NOT NULL,
 state text NOT NULL, suspension_reason text, suspended_at timestamptz,
 CONSTRAINT driving_authorization_subject_class UNIQUE(organization_id,employee_id,class_code),
 FOREIGN KEY(employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,supporting_check_id) REFERENCES driving_licence_check(organization_id,id), CONSTRAINT driving_authorization_state CHECK(state IN ('active','suspended','ended'))
);
--> statement-breakpoint
CREATE TABLE driving_licence_subject (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, employee_id uuid NOT NULL, employment_period_id uuid, suspension_kind text NOT NULL, suspended_at timestamptz NOT NULL, source_check_id uuid,
 CONSTRAINT driving_subject_employee UNIQUE(organization_id,employee_id), FOREIGN KEY(employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE driving_authorization_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, employee_id uuid NOT NULL, employment_period_id uuid, class_code text, check_id uuid,
 kind text NOT NULL, reason text, effective_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL, actor_user_id text,
 FOREIGN KEY(employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE, FOREIGN KEY(organization_id,check_id) REFERENCES driving_licence_check(organization_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE FUNCTION driving_check_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Completed driving licence checks are immutable; add a supplement'; END $$;
--> statement-breakpoint
CREATE TRIGGER driving_check_immutable BEFORE UPDATE ON driving_licence_check FOR EACH ROW EXECUTE FUNCTION driving_check_immutable();
