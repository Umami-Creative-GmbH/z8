CREATE TABLE payroll_comparison_result (
 id uuid PRIMARY KEY,
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 baseline_id uuid NOT NULL,
 digest text NOT NULL,
 result jsonb NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX payroll_comparison_result_org_idx ON payroll_comparison_result(organization_id);
CREATE INDEX payroll_comparison_result_expiry_idx ON payroll_comparison_result(expires_at);
CREATE FUNCTION payroll_comparison_result_no_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Reviewed payroll comparisons are immutable'; END $$;
CREATE TRIGGER payroll_comparison_result_immutable BEFORE UPDATE ON payroll_comparison_result FOR EACH ROW EXECUTE FUNCTION payroll_comparison_result_no_update();
