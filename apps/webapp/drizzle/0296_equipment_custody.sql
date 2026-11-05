ALTER TABLE equipment_item ADD COLUMN in_custody boolean NOT NULL DEFAULT false;
ALTER TABLE equipment_item ADD COLUMN last_handover_date date;
--> statement-breakpoint
CREATE TABLE equipment_assignment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 item_id uuid NOT NULL,
 employee_id uuid,
 employment_period_id uuid,
 return_required boolean NOT NULL,
 explicit_deadline date,
 received boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 CONSTRAINT equipment_assignment_id_org_unique UNIQUE(id, organization_id),
 CONSTRAINT equipment_assignment_item_org_fk FOREIGN KEY(item_id, organization_id) REFERENCES equipment_item(id, organization_id),
 CONSTRAINT equipment_assignment_employee_org_fk FOREIGN KEY(employee_id, organization_id) REFERENCES employee(id, organization_id),
 CONSTRAINT equipment_assignment_period_org_employee_fk FOREIGN KEY(employment_period_id, organization_id, employee_id) REFERENCES employee_employment_period(id, organization_id, employee_id),
 CONSTRAINT equipment_assignment_deadline_check CHECK(return_required OR explicit_deadline IS NULL),
 CONSTRAINT equipment_assignment_revision_positive CHECK(revision > 0)
);
CREATE UNIQUE INDEX equipment_assignment_one_holder ON equipment_assignment(organization_id, item_id) WHERE received = false;
--> statement-breakpoint
CREATE TABLE equipment_handover (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 assignment_id uuid NOT NULL,
 kind text NOT NULL,
 actual_date date NOT NULL,
 condition text NOT NULL,
 notes text,
 actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT equipment_handover_assignment_org_fk FOREIGN KEY(assignment_id, organization_id) REFERENCES equipment_assignment(id, organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_handover_individual_once UNIQUE(organization_id, assignment_id, kind),
 CONSTRAINT equipment_handover_kind_check CHECK(kind IN ('issue', 'receipt')),
 CONSTRAINT equipment_handover_condition_check CHECK(condition IN ('good', 'worn', 'damaged', 'unknown')),
 CONSTRAINT equipment_handover_notes_check CHECK(notes IS NULL OR length(notes) <= 4000)
);
--> statement-breakpoint
CREATE TABLE equipment_command (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 fingerprint text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id, request_id)
);
