-- Spec #766 "Retention": position stamp access-log entries follow the audit-log
-- lifetime (365 days, `AUDIT_LOG_RETENTION_DAYS` in src/lib/audit/cleanup.ts).
-- Entries stay append-only: a delete passes only for an entry older than that
-- lifetime (the retention cleanup), or when its organization, its access-log
-- entry or its subject employee is already gone (parent-deletion cascades). No
-- session flag can unlock it.
CREATE FUNCTION "position_stamp_access_log_delete_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM public."organization" WHERE "id" = OLD.organization_id) THEN
		RETURN OLD;
	END IF;
	IF TG_TABLE_NAME = 'position_stamp_access_log' THEN
		IF OLD.accessed_at < (now() AT TIME ZONE 'UTC') - interval '365 days' THEN
			RETURN OLD;
		END IF;
	ELSIF NOT EXISTS (
		SELECT 1 FROM public."position_stamp_access_log"
		WHERE "id" = OLD.access_log_id AND "organization_id" = OLD.organization_id
	) OR NOT EXISTS (
		SELECT 1 FROM public."employee"
		WHERE "id" = OLD.employee_id AND "organization_id" = OLD.organization_id
	) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'position stamp access log entries are append-only'
		USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "position_stamp_access_log_delete_guard" BEFORE DELETE ON "position_stamp_access_log"
	FOR EACH ROW EXECUTE FUNCTION "position_stamp_access_log_delete_guard"();--> statement-breakpoint
CREATE TRIGGER "position_stamp_access_log_subject_delete_guard" BEFORE DELETE ON "position_stamp_access_log_subject"
	FOR EACH ROW EXECUTE FUNCTION "position_stamp_access_log_delete_guard"();
