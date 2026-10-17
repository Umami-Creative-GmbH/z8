CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_organization_timezone(org text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=o.timezone) THEN o.timezone ELSE 'UTC' END FROM organization o WHERE o.id=org),'UTC');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_organization_date(org text) RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (CURRENT_TIMESTAMP AT TIME ZONE coalesce((SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=o.timezone) THEN o.timezone ELSE 'UTC' END FROM organization o WHERE o.id=org),'UTC'))::date;
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS vacation_policy_rollout (
 organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
 baseline_date date NOT NULL,
 reviewed_from date CHECK(reviewed_from >= DATE '2026-01-01')
);
--> statement-breakpoint
INSERT INTO vacation_policy_rollout(organization_id,baseline_date) SELECT id,greatest(DATE '2026-01-01',vacation_organization_date(id)) FROM organization ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE vacation_policy_assignment ADD COLUMN IF NOT EXISTS effective_start_date date;
ALTER TABLE vacation_policy_assignment ADD COLUMN IF NOT EXISTS effective_end_date date;
ALTER TABLE vacation_policy_assignment ADD COLUMN IF NOT EXISTS legacy_baseline boolean NOT NULL DEFAULT false;
ALTER TABLE vacation_policy_assignment ADD COLUMN IF NOT EXISTS reviewed_backdate boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE vacation_policy_assignment a SET effective_start_date=greatest(DATE '2026-01-01',coalesce((a.effective_from AT TIME ZONE 'UTC' AT TIME ZONE vacation_organization_timezone(o.id))::date,r.baseline_date)), effective_end_date=(a.effective_until AT TIME ZONE 'UTC' AT TIME ZONE vacation_organization_timezone(o.id))::date, legacy_baseline=true FROM organization o,vacation_policy_rollout r WHERE a.organization_id=o.id AND r.organization_id=o.id AND a.effective_start_date IS NULL;
--> statement-breakpoint
ALTER TABLE vacation_policy_assignment ALTER COLUMN effective_start_date SET NOT NULL;
DROP INDEX IF EXISTS "vacationPolicyAssignment_org_default_idx";
DROP INDEX IF EXISTS "vacationPolicyAssignment_team_idx";
DROP INDEX IF EXISTS "vacationPolicyAssignment_employee_idx";
--> statement-breakpoint
-- Retain the team's identifier in dated assignments after the live team is deleted.
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT c.conname FROM pg_constraint c WHERE c.conrelid='vacation_policy_assignment'::regclass AND c.confrelid='team'::regclass LOOP
 EXECUTE format('ALTER TABLE vacation_policy_assignment DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS vacation_team_eligibility (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE, team_id uuid NOT NULL, origin_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('membership','compatibility')), effective_start_date date NOT NULL, effective_end_date date,
 legacy_baseline boolean NOT NULL DEFAULT false,
 CHECK(effective_end_date IS NULL OR effective_end_date >= effective_start_date)
);
CREATE INDEX IF NOT EXISTS vacation_team_eligibility_employee_idx ON vacation_team_eligibility(organization_id,employee_id);
--> statement-breakpoint
INSERT INTO vacation_team_eligibility(organization_id,employee_id,team_id,origin_id,source,effective_start_date,legacy_baseline)
 SELECT m.organization_id,m.employee_id,m.team_id,m.id,'membership',r.baseline_date,true FROM team_membership m JOIN vacation_policy_rollout r ON r.organization_id=m.organization_id JOIN employee e ON e.id=m.employee_id AND e.organization_id=m.organization_id JOIN team t ON t.id=m.team_id AND t.organization_id=m.organization_id
 WHERE NOT EXISTS(SELECT 1 FROM vacation_team_eligibility h WHERE h.origin_id=m.id AND h.source='membership');
INSERT INTO vacation_team_eligibility(organization_id,employee_id,team_id,origin_id,source,effective_start_date,legacy_baseline)
 SELECT e.organization_id,e.id,e.team_id,e.id,'compatibility',r.baseline_date,true FROM employee e JOIN vacation_policy_rollout r ON r.organization_id=e.organization_id JOIN team t ON t.id=e.team_id AND t.organization_id=e.organization_id
 WHERE NOT EXISTS(SELECT 1 FROM vacation_team_eligibility h WHERE h.origin_id=e.id AND h.source='compatibility');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS vacation_policy_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 policy_id uuid NOT NULL REFERENCES vacation_allowance(id) ON DELETE CASCADE,
 effective_start_date date NOT NULL, effective_end_date date, policy jsonb NOT NULL,created_at timestamp NOT NULL DEFAULT now(),
 CHECK(effective_end_date IS NULL OR effective_end_date >= effective_start_date)
);
CREATE INDEX IF NOT EXISTS vacation_policy_revision_policy_idx ON vacation_policy_revision(organization_id,policy_id);
INSERT INTO vacation_policy_revision(organization_id,policy_id,effective_start_date,effective_end_date,policy)
 SELECT p.organization_id,p.id,p.start_date,p.valid_until+1,to_jsonb(p) FROM vacation_allowance p WHERE NOT EXISTS(SELECT 1 FROM vacation_policy_revision v WHERE v.policy_id=p.id AND v.organization_id=p.organization_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_initialize_organization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO vacation_policy_rollout(organization_id,baseline_date) VALUES(NEW.id,greatest(DATE '2026-01-01',vacation_organization_date(NEW.id))) ON CONFLICT DO NOTHING; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vacation_initialize_organization ON organization;
CREATE TRIGGER vacation_initialize_organization AFTER INSERT ON organization FOR EACH ROW EXECUTE FUNCTION vacation_initialize_organization();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_assignment_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE today date:=vacation_organization_date(NEW.organization_id); BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vacation-policy:'||NEW.organization_id,0));
 IF NOT EXISTS(SELECT 1 FROM vacation_allowance p WHERE p.id=NEW.policy_id AND p.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Vacation policy must belong to the active organization'; END IF;
 IF NEW.employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employee e WHERE e.id=NEW.employee_id AND e.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Vacation employee must belong to the active organization'; END IF;
 IF TG_OP='INSERT' AND NEW.team_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM team t WHERE t.id=NEW.team_id AND t.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Vacation team must belong to the active organization'; END IF;
 IF (NEW.assignment_type='employee' AND (NEW.employee_id IS NULL OR NEW.team_id IS NOT NULL)) OR (NEW.assignment_type='team' AND (NEW.team_id IS NULL OR NEW.employee_id IS NOT NULL)) OR (NEW.assignment_type='organization' AND (NEW.team_id IS NOT NULL OR NEW.employee_id IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid vacation assignment target'; END IF;
 NEW.effective_start_date:=coalesce(NEW.effective_start_date,(NEW.effective_from AT TIME ZONE 'UTC' AT TIME ZONE vacation_organization_timezone(NEW.organization_id))::date,today);
 NEW.effective_end_date:=coalesce(NEW.effective_end_date,(NEW.effective_until AT TIME ZONE 'UTC' AT TIME ZONE vacation_organization_timezone(NEW.organization_id))::date);
 IF NEW.effective_start_date < DATE '2026-01-01' THEN RAISE EXCEPTION 'Reviewed vacation history starts in 2026 or later'; END IF;
 IF NEW.effective_end_date IS NOT NULL AND NEW.effective_end_date < NEW.effective_start_date THEN RAISE EXCEPTION 'Vacation assignment end must follow its start'; END IF;
 IF TG_OP='UPDATE' AND OLD.is_active AND NOT NEW.is_active THEN NEW.is_active:=true; NEW.effective_end_date:=greatest(NEW.effective_start_date,today); END IF;
 IF TG_OP='UPDATE' AND (OLD.policy_id<>NEW.policy_id OR OLD.organization_id<>NEW.organization_id OR OLD.assignment_type<>NEW.assignment_type OR OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.employee_id IS DISTINCT FROM NEW.employee_id) THEN RAISE EXCEPTION 'Replace a dated vacation assignment instead of rewriting its history'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vacation_assignment_dates ON vacation_policy_assignment;
CREATE TRIGGER vacation_assignment_dates BEFORE INSERT OR UPDATE ON vacation_policy_assignment FOR EACH ROW EXECUTE FUNCTION vacation_assignment_dates();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_record_policy_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE change_date date; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vacation-policy:'||NEW.organization_id,0));
 IF TG_OP='INSERT' THEN
  INSERT INTO vacation_policy_revision(organization_id,policy_id,effective_start_date,effective_end_date,policy) VALUES(NEW.organization_id,NEW.id,NEW.start_date,NEW.valid_until+1,to_jsonb(NEW)); RETURN NEW;
 END IF;
 IF NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Vacation policy organization cannot change'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 change_date:=coalesce(nullif(current_setting('z8.vacation_effective_date',true),'')::date,CASE WHEN NEW.start_date IS DISTINCT FROM OLD.start_date OR OLD.start_date>vacation_organization_date(NEW.organization_id) THEN NEW.start_date ELSE vacation_organization_date(NEW.organization_id) END);
 IF NEW.accrual_type<>OLD.accrual_type OR NEW.prorate_in_start_and_exit_year<>OLD.prorate_in_start_and_exit_year THEN
  IF to_char(change_date,'MM-DD')<>'01-01' THEN RAISE EXCEPTION 'Vacation calculation method and joiner/leaver proration may change only on 1 January'; END IF;
 END IF;
 -- Closing a superseded definition ends its previous snapshot without changing its historical default flag.
 IF NEW.valid_until IS DISTINCT FROM OLD.valid_until AND NEW.valid_until IS NOT NULL AND (NOT NEW.is_company_default OR NEW.is_active=OLD.is_active) THEN
  UPDATE vacation_policy_revision SET effective_end_date=least(coalesce(effective_end_date,NEW.valid_until+1),NEW.valid_until+1) WHERE policy_id=NEW.id AND organization_id=NEW.organization_id AND effective_start_date<=NEW.valid_until;
  DELETE FROM vacation_policy_revision WHERE policy_id=NEW.id AND organization_id=NEW.organization_id AND effective_start_date>NEW.valid_until;
  RETURN NEW;
 END IF;
 UPDATE vacation_policy_revision SET effective_end_date=change_date WHERE policy_id=NEW.id AND organization_id=NEW.organization_id AND effective_start_date<change_date AND (effective_end_date IS NULL OR effective_end_date>change_date);
 DELETE FROM vacation_policy_revision WHERE policy_id=NEW.id AND organization_id=NEW.organization_id AND effective_start_date>=change_date;
 IF NEW.is_active AND (NEW.valid_until IS NULL OR NEW.valid_until>=greatest(NEW.start_date,change_date)) THEN INSERT INTO vacation_policy_revision(organization_id,policy_id,effective_start_date,effective_end_date,policy) VALUES(NEW.organization_id,NEW.id,greatest(NEW.start_date,change_date),NEW.valid_until+1,to_jsonb(NEW)); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vacation_record_policy_revision ON vacation_allowance;
CREATE TRIGGER vacation_record_policy_revision AFTER INSERT OR UPDATE ON vacation_allowance FOR EACH ROW EXECUTE FUNCTION vacation_record_policy_revision();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_record_team_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text; origin uuid; emp uuid; old_team uuid; new_team uuid; kind text; change_date date; BEGIN
 IF TG_TABLE_NAME='team_membership' THEN IF TG_OP='UPDATE' THEN IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.team_id IS DISTINCT FROM OLD.team_id THEN RAISE EXCEPTION 'Team membership identity cannot change; replace the membership instead'; END IF; END IF; END IF;
 IF TG_TABLE_NAME='team_membership' THEN
  kind:='membership'; IF TG_OP='DELETE' THEN org:=OLD.organization_id;origin:=OLD.id;emp:=OLD.employee_id;old_team:=OLD.team_id; ELSE org:=NEW.organization_id;origin:=NEW.id;emp:=NEW.employee_id;new_team:=NEW.team_id; IF TG_OP='UPDATE' THEN old_team:=OLD.team_id; END IF; END IF;
 ELSE
  kind:='compatibility'; IF TG_OP='DELETE' THEN org:=OLD.organization_id;origin:=OLD.id;emp:=OLD.id;old_team:=OLD.team_id; ELSE org:=NEW.organization_id;origin:=NEW.id;emp:=NEW.id;new_team:=NEW.team_id; IF TG_OP='UPDATE' THEN old_team:=OLD.team_id; END IF; END IF;
 END IF;
 IF TG_OP='UPDATE' AND old_team IS NOT DISTINCT FROM new_team THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization WHERE id=org) THEN RETURN coalesce(NEW,OLD); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vacation-policy:'||org,0));
 change_date:=coalesce(nullif(current_setting('z8.vacation_effective_date',true),'')::date,vacation_organization_date(org));
 UPDATE vacation_team_eligibility SET effective_end_date=greatest(effective_start_date,change_date) WHERE organization_id=org AND origin_id=origin AND source=kind AND effective_end_date IS NULL;
 IF new_team IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM team WHERE id=new_team AND organization_id=org) THEN RAISE EXCEPTION 'Vacation team must belong to the active organization'; END IF;
  INSERT INTO vacation_team_eligibility(organization_id,employee_id,team_id,origin_id,source,effective_start_date) VALUES(org,emp,new_team,origin,kind,change_date);
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS vacation_record_membership_eligibility ON team_membership;
CREATE TRIGGER vacation_record_membership_eligibility AFTER INSERT OR UPDATE OR DELETE ON team_membership FOR EACH ROW EXECUTE FUNCTION vacation_record_team_eligibility();
DROP TRIGGER IF EXISTS vacation_record_compatibility_eligibility ON employee;
CREATE TRIGGER vacation_record_compatibility_eligibility AFTER INSERT OR UPDATE OF team_id ON employee FOR EACH ROW EXECUTE FUNCTION vacation_record_team_eligibility();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_policy_at(org text,emp uuid,on_date date)
 RETURNS TABLE(status text,policy_ids uuid[],source text,revision_id uuid,baseline_transition_allowed boolean) LANGUAGE sql STABLE AS $$
 WITH target AS (SELECT id FROM employee WHERE id=emp AND organization_id=org),
 rollout AS (SELECT greatest(DATE '2026-01-01',least(r.baseline_date,coalesce((SELECT min(a.effective_start_date) FROM vacation_policy_assignment a WHERE a.organization_id=org AND a.is_active AND a.reviewed_backdate AND (a.assignment_type='organization' OR (a.assignment_type='employee' AND a.employee_id=emp) OR (a.assignment_type='team' AND EXISTS(SELECT 1 FROM vacation_team_eligibility h WHERE h.organization_id=org AND h.employee_id=emp AND h.team_id=a.team_id AND h.effective_start_date<=a.effective_start_date AND (h.effective_end_date IS NULL OR a.effective_start_date<h.effective_end_date))))),r.baseline_date))) AS first_date,r.baseline_date FROM vacation_policy_rollout r WHERE r.organization_id=org),
 eligible AS (SELECT h.* FROM vacation_team_eligibility h WHERE h.organization_id=org AND h.employee_id=emp AND h.effective_start_date<=on_date AND (h.effective_end_date IS NULL OR on_date<h.effective_end_date) AND (h.source='membership' OR NOT EXISTS(SELECT 1 FROM vacation_team_eligibility m WHERE m.organization_id=org AND m.employee_id=emp AND m.source='membership' AND m.effective_start_date<=on_date AND (m.effective_end_date IS NULL OR on_date<m.effective_end_date)))),
 revisions AS (SELECT v.*,p.is_company_default,p.is_active FROM vacation_policy_revision v CROSS JOIN LATERAL jsonb_populate_record(NULL::vacation_allowance,v.policy) p WHERE v.organization_id=org AND p.organization_id=org AND p.is_active AND v.effective_start_date<=on_date AND (v.effective_end_date IS NULL OR on_date<v.effective_end_date)),
 candidates AS (
 SELECT v.policy_id,v.id AS revision_id,a.assignment_type::text AS source,CASE a.assignment_type WHEN 'employee' THEN 3 WHEN 'team' THEN 2 ELSE 1 END AS priority,a.legacy_baseline AND (a.assignment_type<>'team' OR EXISTS(SELECT 1 FROM eligible h WHERE h.team_id=a.team_id AND h.legacy_baseline AND h.effective_start_date<=on_date AND (h.effective_end_date IS NULL OR on_date<h.effective_end_date))) AS baseline_ok
 FROM vacation_policy_assignment a JOIN revisions v ON v.policy_id=a.policy_id WHERE a.organization_id=org AND a.is_active AND a.effective_start_date<=on_date AND (a.effective_end_date IS NULL OR on_date<a.effective_end_date) AND ((a.assignment_type='employee' AND a.employee_id=emp) OR a.assignment_type='organization' OR (a.assignment_type='team' AND EXISTS(SELECT 1 FROM eligible h WHERE h.team_id=a.team_id AND h.effective_start_date<=on_date AND (h.effective_end_date IS NULL OR on_date<h.effective_end_date))))
 UNION ALL SELECT v.policy_id,v.id,'company_default',0,true FROM (SELECT * FROM revisions WHERE is_company_default ORDER BY (policy->>'start_date')::date DESC,policy_id LIMIT 1) v
 ), preferred AS (SELECT * FROM candidates WHERE priority=(SELECT max(priority) FROM candidates)),
 result AS (SELECT array_agg(DISTINCT policy_id) ids,min(source) source,(array_agg(revision_id ORDER BY revision_id))[1] revision_id,bool_and(baseline_ok) baseline_ok FROM preferred),
 legacy AS (SELECT id FROM vacation_allowance WHERE organization_id=org AND is_company_default AND is_active AND start_date<=make_date(extract(year from on_date)::int,12,31) AND (valid_until IS NULL OR valid_until>=make_date(extract(year from on_date)::int,1,1)) ORDER BY start_date DESC LIMIT 1)
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM target) THEN 'missing' WHEN on_date<coalesce((SELECT first_date FROM rollout),DATE '9999-01-01') THEN 'legacy' WHEN result.baseline_ok AND result.source<>'company_default' AND on_date>=(SELECT baseline_date FROM rollout) AND extract(year FROM on_date)=extract(year FROM (SELECT baseline_date FROM rollout)) AND to_char((SELECT baseline_date FROM rollout),'MM-DD')<>'01-01' AND EXISTS(SELECT 1 FROM legacy l JOIN vacation_allowance old_policy ON old_policy.id=l.id AND old_policy.organization_id=org JOIN vacation_policy_revision new_policy ON new_policy.id=result.revision_id AND new_policy.organization_id=org WHERE old_policy.accrual_type IS DISTINCT FROM new_policy.policy->>'accrual_type' OR old_policy.prorate_in_start_and_exit_year IS DISTINCT FROM (new_policy.policy->>'prorate_in_start_and_exit_year')::boolean) THEN 'incompatible_transition' WHEN cardinality(result.ids)>1 THEN 'conflict' WHEN cardinality(result.ids)=1 THEN 'resolved' ELSE 'missing' END,
 CASE WHEN on_date<coalesce((SELECT first_date FROM rollout),DATE '9999-01-01') THEN ARRAY(SELECT id FROM legacy) ELSE coalesce(result.ids,'{}'::uuid[]) END,
 CASE WHEN on_date<coalesce((SELECT first_date FROM rollout),DATE '9999-01-01') THEN 'company_default' ELSE result.source END,
 CASE WHEN on_date<coalesce((SELECT first_date FROM rollout),DATE '9999-01-01') THEN NULL ELSE result.revision_id END,
 on_date=(SELECT baseline_date FROM rollout) AND coalesce(result.baseline_ok,false)
 FROM result;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_assert_method_boundaries(org text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target record; boundary record; terms jsonb; resolution record; previous_method text; previous_proration boolean; previous_year int; BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization WHERE id=org) THEN RETURN; END IF;
 FOR target IN SELECT id FROM employee WHERE organization_id=org LOOP
  previous_method:=NULL; previous_proration:=NULL; previous_year:=NULL;
  FOR boundary IN
   WITH known_dates AS (
    SELECT effective_start_date AS boundary_date FROM vacation_policy_assignment WHERE organization_id=org AND is_active
    UNION SELECT effective_end_date FROM vacation_policy_assignment WHERE organization_id=org AND is_active
    UNION SELECT effective_start_date FROM vacation_team_eligibility WHERE organization_id=org AND employee_id=target.id
    UNION SELECT effective_end_date FROM vacation_team_eligibility WHERE organization_id=org AND employee_id=target.id
    UNION SELECT effective_start_date FROM vacation_policy_revision WHERE organization_id=org
    UNION SELECT effective_end_date FROM vacation_policy_revision WHERE organization_id=org
    UNION SELECT greatest(DATE '2026-01-01',least(baseline_date,coalesce(reviewed_from,baseline_date))) FROM vacation_policy_rollout WHERE organization_id=org
   ), all_dates AS (
    SELECT boundary_date FROM known_dates
    UNION SELECT make_date(y,1,1) FROM generate_series(2026,greatest(2026,extract(year FROM coalesce((SELECT max(boundary_date) FROM known_dates),vacation_organization_date(org)))::int)) y
   ) SELECT boundary_date FROM all_dates WHERE boundary_date>=DATE '2026-01-01' ORDER BY boundary_date LOOP
    IF previous_year IS DISTINCT FROM extract(year FROM boundary.boundary_date)::int THEN previous_method:=NULL;previous_proration:=NULL;previous_year:=extract(year FROM boundary.boundary_date)::int; END IF;
    SELECT * INTO resolution FROM vacation_policy_at(org,target.id,boundary.boundary_date);
    IF resolution.status NOT IN ('resolved','legacy') OR cardinality(resolution.policy_ids)<>1 THEN CONTINUE; END IF;
    terms:=NULL;
    IF resolution.revision_id IS NOT NULL THEN SELECT policy INTO terms FROM vacation_policy_revision WHERE id=resolution.revision_id AND organization_id=org;
    ELSE SELECT to_jsonb(p) INTO terms FROM vacation_allowance p WHERE id=resolution.policy_ids[1] AND organization_id=org; END IF;
    IF terms IS NULL THEN CONTINUE; END IF;
    IF previous_method IS NOT NULL AND (previous_method IS DISTINCT FROM terms->>'accrual_type' OR previous_proration IS DISTINCT FROM (terms->>'prorate_in_start_and_exit_year')::boolean) THEN
     RAISE EXCEPTION 'Vacation calculation method and joiner/leaver proration may change only on 1 January (employee %, date %)',target.id,boundary.boundary_date;
    END IF;
    previous_method:=terms->>'accrual_type';previous_proration:=(terms->>'prorate_in_start_and_exit_year')::boolean;
   END LOOP;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_validate_policy_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('z8.vacation_dirty_'||md5(coalesce(NEW.organization_id,OLD.organization_id)),true)='false' THEN RETURN NULL; END IF;
 PERFORM vacation_assert_method_boundaries(coalesce(NEW.organization_id,OLD.organization_id));
 PERFORM set_config('z8.vacation_dirty_'||md5(coalesce(NEW.organization_id,OLD.organization_id)),'false',true); RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS vacation_validate_assignment_transition ON vacation_policy_assignment;
CREATE CONSTRAINT TRIGGER vacation_validate_assignment_transition AFTER INSERT OR UPDATE OR DELETE ON vacation_policy_assignment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vacation_validate_policy_transition();
DROP TRIGGER IF EXISTS vacation_validate_revision_transition ON vacation_policy_revision;
CREATE CONSTRAINT TRIGGER vacation_validate_revision_transition AFTER INSERT OR UPDATE OR DELETE ON vacation_policy_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vacation_validate_policy_transition();
DROP TRIGGER IF EXISTS vacation_validate_eligibility_transition ON vacation_team_eligibility;
CREATE CONSTRAINT TRIGGER vacation_validate_eligibility_transition AFTER INSERT OR UPDATE OR DELETE ON vacation_team_eligibility DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vacation_validate_policy_transition();
DROP TRIGGER IF EXISTS vacation_validate_rollout_transition ON vacation_policy_rollout;
CREATE CONSTRAINT TRIGGER vacation_validate_rollout_transition AFTER UPDATE ON vacation_policy_rollout DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vacation_validate_policy_transition();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_retain_dated_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RAISE EXCEPTION 'Vacation history cannot be deleted; end its effective window instead'; END IF; RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS vacation_retain_assignment_history ON vacation_policy_assignment;
CREATE TRIGGER vacation_retain_assignment_history BEFORE DELETE ON vacation_policy_assignment FOR EACH ROW EXECUTE FUNCTION vacation_retain_dated_history();
DROP TRIGGER IF EXISTS vacation_retain_policy_history ON vacation_allowance;
CREATE TRIGGER vacation_retain_policy_history BEFORE DELETE ON vacation_allowance FOR EACH ROW EXECUTE FUNCTION vacation_retain_dated_history();
--> statement-breakpoint
UPDATE vacation_policy_assignment SET effective_end_date=effective_start_date WHERE effective_end_date<effective_start_date;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='vacation_assignment_employee_window') THEN
  ALTER TABLE vacation_policy_assignment ADD CONSTRAINT vacation_assignment_employee_window EXCLUDE USING gist(organization_id WITH =,employee_id WITH =,daterange(effective_start_date,effective_end_date,'[)') WITH &&) WHERE(assignment_type='employee' AND is_active);
  ALTER TABLE vacation_policy_assignment ADD CONSTRAINT vacation_assignment_team_window EXCLUDE USING gist(organization_id WITH =,team_id WITH =,daterange(effective_start_date,effective_end_date,'[)') WITH &&) WHERE(assignment_type='team' AND is_active);
  ALTER TABLE vacation_policy_assignment ADD CONSTRAINT vacation_assignment_organization_window EXCLUDE USING gist(organization_id WITH =,daterange(effective_start_date,effective_end_date,'[)') WITH &&) WHERE(assignment_type='organization' AND is_active);
 END IF;
END $$;








--> statement-breakpoint
CREATE OR REPLACE FUNCTION vacation_mark_policy_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text:=coalesce(NEW.organization_id,OLD.organization_id); BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vacation-policy:'||org,0));
 PERFORM set_config('z8.vacation_dirty_'||md5(org),'true',true); RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS vacation_mark_assignment_dirty ON vacation_policy_assignment;
CREATE TRIGGER vacation_mark_assignment_dirty BEFORE INSERT OR UPDATE OR DELETE ON vacation_policy_assignment FOR EACH ROW EXECUTE FUNCTION vacation_mark_policy_dirty();
DROP TRIGGER IF EXISTS vacation_mark_revision_dirty ON vacation_policy_revision;
CREATE TRIGGER vacation_mark_revision_dirty BEFORE INSERT OR UPDATE OR DELETE ON vacation_policy_revision FOR EACH ROW EXECUTE FUNCTION vacation_mark_policy_dirty();
DROP TRIGGER IF EXISTS vacation_mark_eligibility_dirty ON vacation_team_eligibility;
CREATE TRIGGER vacation_mark_eligibility_dirty BEFORE INSERT OR UPDATE OR DELETE ON vacation_team_eligibility FOR EACH ROW EXECUTE FUNCTION vacation_mark_policy_dirty();
DROP TRIGGER IF EXISTS vacation_mark_rollout_dirty ON vacation_policy_rollout;
CREATE TRIGGER vacation_mark_rollout_dirty BEFORE UPDATE ON vacation_policy_rollout FOR EACH ROW EXECUTE FUNCTION vacation_mark_policy_dirty();


