CREATE TABLE IF NOT EXISTS driving_licence_verifier_grant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 verifier_employee_id uuid NOT NULL,
 employment_period_id uuid,
 scope text NOT NULL CONSTRAINT driving_verifier_scope_check CHECK (scope IN ('all','specific')),
 team_ids jsonb NOT NULL DEFAULT '[]',
 employee_ids jsonb NOT NULL DEFAULT '[]',
 granted_at timestamptz NOT NULL DEFAULT now(),
 granted_by text NOT NULL REFERENCES "user"(id),
 expires_at timestamptz,
 revoked_at timestamptz,
 revoked_by text REFERENCES "user"(id),
 CONSTRAINT driving_verifier_employee_org_fk FOREIGN KEY (verifier_employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT driving_verifier_period_fk FOREIGN KEY (employment_period_id,organization_id,verifier_employee_id) REFERENCES employee_employment_period(id,organization_id,employee_id),
 CONSTRAINT driving_verifier_scope_arrays_check CHECK (jsonb_typeof(team_ids) = 'array' AND jsonb_typeof(employee_ids) = 'array'),
 CONSTRAINT driving_verifier_nonempty_scope_check CHECK ((scope = 'all' AND jsonb_array_length(team_ids) = 0 AND jsonb_array_length(employee_ids) = 0) OR (scope = 'specific' AND (jsonb_array_length(team_ids) > 0 OR jsonb_array_length(employee_ids) > 0))),
 CONSTRAINT driving_verifier_expiry_check CHECK (expires_at IS NULL OR expires_at > granted_at),
 CONSTRAINT driving_verifier_revocation_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS driving_verifier_organization_idx ON driving_licence_verifier_grant(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS driving_verifier_one_current_idx ON driving_licence_verifier_grant(organization_id,verifier_employee_id) WHERE revoked_at IS NULL;
