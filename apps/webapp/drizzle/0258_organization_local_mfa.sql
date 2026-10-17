CREATE TABLE organization_mfa_policy (
 organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 grace_period_days integer NOT NULL DEFAULT 14 CHECK (grace_period_days IN (0,7,14,30)),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by text NOT NULL REFERENCES "user"(id)
);
--> statement-breakpoint
CREATE TABLE organization_mfa_window (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 starts_at timestamptz NOT NULL,
 grace_period_days integer NOT NULL CHECK (grace_period_days IN (0,7,14,30)),
 deadline timestamptz,
 last_qualifying_access_at timestamptz,
 CONSTRAINT organization_mfa_window_identity_idx UNIQUE (organization_id,user_id)
);
CREATE INDEX organization_mfa_window_org_idx ON organization_mfa_window(organization_id);
CREATE INDEX organization_mfa_window_user_idx ON organization_mfa_window(user_id);
--> statement-breakpoint
CREATE TABLE session_mfa_proof (
 session_id text PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 method text NOT NULL CHECK (method IN ('totp','passkey')),
 factor_id text NOT NULL,
 factor_fingerprint text NOT NULL,
 verified_at timestamptz NOT NULL
);
CREATE INDEX session_mfa_proof_user_idx ON session_mfa_proof(user_id);
CREATE TABLE session_authentication (
 session_id text PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 method text NOT NULL,
 verified_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE organization_mfa_notice (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 deduplication_key text NOT NULL,
 kind text NOT NULL,
 due_at timestamptz NOT NULL,
 payload jsonb NOT NULL,
 sent_at timestamptz,
 CONSTRAINT organization_mfa_notice_identity_idx UNIQUE(organization_id,deduplication_key)
);
CREATE INDEX organization_mfa_notice_due_idx ON organization_mfa_notice(due_at);
CREATE TABLE organization_mfa_access_outcome (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
 outcome text NOT NULL,
 PRIMARY KEY(organization_id,session_id)
);
--> statement-breakpoint
-- Capture activation instants at every membership/employee lifecycle writer, including SCIM.
-- No calendar/time-window arithmetic here: Temporal materializes the frozen event's deadline.
CREATE FUNCTION z8_capture_mfa_window(p_org text, p_user text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO organization_mfa_window(organization_id,user_id,starts_at,grace_period_days)
 SELECT p.organization_id,m.user_id,date_trunc('milliseconds',clock_timestamp()),p.grace_period_days
 FROM organization_mfa_policy p JOIN member m ON m.organization_id=p.organization_id
 JOIN "user" u ON u.id=m.user_id
 WHERE p.organization_id=p_org AND p.enabled AND (p_user IS NULL OR m.user_id=p_user)
 AND m.status='approved' AND lower(u.email) NOT LIKE '%@kiosk.invalid'
 AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.organization_id=p.organization_id AND e.user_id=m.user_id AND (NOT e.is_active OR employee_departure_denies_access(e.organization_id,e.id,clock_timestamp())))
 ON CONFLICT(organization_id,user_id) DO NOTHING;
END $$;
--> statement-breakpoint
CREATE FUNCTION z8_lock_mfa_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('organization-mfa:' || NEW.organization_id,0));
 RETURN NEW;
END $$;
CREATE TRIGGER organization_mfa_policy_lock BEFORE INSERT OR UPDATE ON organization_mfa_policy FOR EACH ROW EXECUTE FUNCTION z8_lock_mfa_scope();
CREATE TRIGGER organization_mfa_member_lock BEFORE INSERT OR UPDATE ON member FOR EACH ROW EXECUTE FUNCTION z8_lock_mfa_scope();
CREATE TRIGGER organization_mfa_employee_lock BEFORE INSERT OR UPDATE ON employee FOR EACH ROW EXECUTE FUNCTION z8_lock_mfa_scope();
--> statement-breakpoint
CREATE FUNCTION z8_capture_mfa_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='organization_mfa_policy' THEN
  PERFORM z8_capture_mfa_window(NEW.organization_id);
 ELSE
  PERFORM z8_capture_mfa_window(NEW.organization_id,NEW.user_id);
 END IF;
 RETURN NEW;
END $$;
-- Capture the final lifecycle state. SCIM can insert membership before an inactive employee in one transaction.
CREATE CONSTRAINT TRIGGER organization_mfa_policy_capture AFTER INSERT OR UPDATE ON organization_mfa_policy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION z8_capture_mfa_scope();
CREATE CONSTRAINT TRIGGER organization_mfa_member_capture AFTER INSERT OR UPDATE ON member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION z8_capture_mfa_scope();
CREATE CONSTRAINT TRIGGER organization_mfa_employee_capture AFTER INSERT OR UPDATE ON employee DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION z8_capture_mfa_scope();
--> statement-breakpoint
CREATE FUNCTION z8_capture_mfa_interactive_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text;
BEGIN
 IF OLD.email IS DISTINCT FROM NEW.email THEN
  FOR org IN SELECT organization_id FROM member WHERE user_id=NEW.id ORDER BY organization_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('organization-mfa:' || org,0));
   PERFORM z8_capture_mfa_window(org,NEW.id);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER organization_mfa_user_capture AFTER UPDATE ON "user" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION z8_capture_mfa_interactive_user();

--> statement-breakpoint
CREATE TABLE user_mfa_revision (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE FUNCTION z8_mfa_security_event(p_user text,p_event text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE org text;
BEGIN
 FOR org IN SELECT p.organization_id FROM organization_mfa_policy p JOIN member m ON m.organization_id=p.organization_id WHERE p.enabled AND m.user_id=p_user LOOP
  INSERT INTO audit_log(organization_id,entity_type,entity_id,action,performed_by,metadata)
  VALUES(org,'organization_mfa',gen_random_uuid(),'mfa.authentication_invalidated',p_user,json_build_object('event',p_event)::text);
  INSERT INTO organization_mfa_notice(organization_id,user_id,deduplication_key,kind,due_at,payload)
  VALUES(org,p_user,gen_random_uuid()::text,'security',clock_timestamp(),json_build_object('event',p_event));
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION z8_mfa_invalidate_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.password IS DISTINCT FROM NEW.password THEN
  PERFORM id FROM "user" WHERE id=NEW.user_id FOR UPDATE;
  INSERT INTO user_mfa_revision(user_id,revision) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=user_mfa_revision.revision+1;
  DELETE FROM session_mfa_proof WHERE user_id=NEW.user_id;
  DELETE FROM session_authentication WHERE user_id=NEW.user_id;
  DELETE FROM verification WHERE value=NEW.user_id AND identifier LIKE 'trust-device-%';
  PERFORM z8_mfa_security_event(NEW.user_id,'password_changed');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_mfa_password_invalidation AFTER UPDATE OF password ON account FOR EACH ROW EXECUTE FUNCTION z8_mfa_invalidate_account();
--> statement-breakpoint
CREATE FUNCTION z8_mfa_invalidate_factor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_user text; factor text; global_reset boolean := false;
BEGIN
 IF TG_OP='DELETE' THEN affected_user:=OLD.user_id; factor:=OLD.id;
 ELSE affected_user:=NEW.user_id; factor:=NEW.id; END IF;
 IF NOT EXISTS (SELECT 1 FROM "user" WHERE id=affected_user) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_TABLE_NAME='two_factor' AND TG_OP='UPDATE' THEN
  global_reset := OLD.backup_codes IS DISTINCT FROM NEW.backup_codes;
 END IF;
 IF global_reset THEN
  PERFORM id FROM "user" WHERE id=affected_user FOR UPDATE;
  INSERT INTO user_mfa_revision(user_id,revision) VALUES(affected_user,1) ON CONFLICT(user_id) DO UPDATE SET revision=user_mfa_revision.revision+1;
  DELETE FROM session_mfa_proof WHERE user_id=affected_user;
  DELETE FROM session_authentication WHERE user_id=affected_user;
  DELETE FROM verification WHERE value=affected_user AND identifier LIKE 'trust-device-%';
 ELSIF TG_OP='DELETE' THEN
  DELETE FROM session_mfa_proof WHERE user_id=affected_user AND factor_id=factor;
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='two_factor' THEN
  IF OLD.secret IS DISTINCT FROM NEW.secret THEN DELETE FROM session_mfa_proof WHERE user_id=affected_user AND factor_id=factor; END IF;
 END IF;
 IF TG_OP <> 'UPDATE' OR TG_TABLE_NAME='two_factor' THEN
  PERFORM z8_mfa_security_event(affected_user, CASE WHEN global_reset THEN 'recovery_codes_changed' ELSE TG_TABLE_NAME || '_' || lower(TG_OP) END);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_mfa_totp_insert AFTER INSERT ON two_factor FOR EACH ROW EXECUTE FUNCTION z8_mfa_invalidate_factor();
CREATE TRIGGER organization_mfa_totp_update AFTER UPDATE OF secret,backup_codes ON two_factor FOR EACH ROW EXECUTE FUNCTION z8_mfa_invalidate_factor();
CREATE TRIGGER organization_mfa_totp_delete AFTER DELETE ON two_factor FOR EACH ROW EXECUTE FUNCTION z8_mfa_invalidate_factor();
CREATE TRIGGER organization_mfa_passkey_insert AFTER INSERT ON passkey FOR EACH ROW EXECUTE FUNCTION z8_mfa_invalidate_factor();
CREATE TRIGGER organization_mfa_passkey_delete AFTER DELETE ON passkey FOR EACH ROW EXECUTE FUNCTION z8_mfa_invalidate_factor();
--> statement-breakpoint
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'organization_mfa_notice';


--> statement-breakpoint
CREATE FUNCTION z8_capture_mfa_departure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_user text;
BEGIN
 SELECT user_id INTO affected_user FROM employee WHERE id=NEW.employee_id AND organization_id=NEW.organization_id;
 IF affected_user IS NOT NULL THEN PERFORM z8_capture_mfa_window(NEW.organization_id,affected_user); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_mfa_departure_lock BEFORE INSERT OR UPDATE ON employee_departure FOR EACH ROW EXECUTE FUNCTION z8_lock_mfa_scope();
CREATE CONSTRAINT TRIGGER organization_mfa_departure_capture AFTER INSERT OR UPDATE ON employee_departure DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION z8_capture_mfa_departure();
