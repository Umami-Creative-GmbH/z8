CREATE TABLE equipment_officer_grant (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL,
 scope text NOT NULL,
 team_ids uuid[] NOT NULL DEFAULT '{}',
 employee_ids uuid[] NOT NULL DEFAULT '{}',
 revoked_at timestamptz,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
 PRIMARY KEY (organization_id, employee_id),
 FOREIGN KEY (employee_id, organization_id) REFERENCES employee(id, organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_officer_scope_check CHECK ((scope = 'all' AND cardinality(team_ids) = 0 AND cardinality(employee_ids) = 0) OR (scope = 'selected' AND cardinality(team_ids) + cardinality(employee_ids) > 0)),
 CONSTRAINT equipment_officer_revision_positive CHECK (revision > 0)
);
--> statement-breakpoint
CREATE TABLE equipment_former_team_scope (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL,
 team_ids uuid[] NOT NULL,
 captured_at timestamptz NOT NULL,
 PRIMARY KEY (organization_id, employee_id),
 FOREIGN KEY (employee_id, organization_id) REFERENCES employee(id, organization_id) ON DELETE CASCADE
);
