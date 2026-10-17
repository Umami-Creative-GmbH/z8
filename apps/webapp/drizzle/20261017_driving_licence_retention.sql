ALTER TABLE driving_authorization ALTER COLUMN supporting_check_id DROP NOT NULL;
ALTER TABLE driving_authorization ADD CONSTRAINT driving_authorization_active_evidence CHECK (state <> 'active' OR supporting_check_id IS NOT NULL);
CREATE TABLE driving_licence_retention (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 check_id uuid NOT NULL,
 retention_started_at timestamptz,
 CONSTRAINT driving_retention_check UNIQUE(organization_id,check_id),
 FOREIGN KEY(organization_id,check_id) REFERENCES driving_licence_check(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE driving_licence_hold (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 check_id uuid NOT NULL,
 case_reference text NOT NULL,
 preservation_reason text NOT NULL,
 placed_at timestamptz NOT NULL,
 placed_by text NOT NULL,
 released_at timestamptz,
 released_by text,
 release_reason text,
 FOREIGN KEY(organization_id,check_id) REFERENCES driving_licence_check(organization_id,id) ON DELETE CASCADE,
 CONSTRAINT driving_hold_specific_case CHECK(length(trim(case_reference)) >= 3 AND length(trim(preservation_reason)) >= 10)
);
CREATE TABLE driving_licence_cleanup_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 completed_at timestamptz NOT NULL,
 actor_user_id text,
 deleted_count integer NOT NULL,
 held_count integer NOT NULL,
 protected_count integer NOT NULL
);
