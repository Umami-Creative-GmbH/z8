-- #2082: HR records a leave notice given outside Z8 (external leave notice) through a dated
-- attestation, and separately documents the employee's opportunity to take the covered days.
-- Both records are final: later corrections (#2086) add records instead of rewriting these.
CREATE TABLE IF NOT EXISTS "vacation_external_leave_notice" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "leave_year" integer NOT NULL,
 "days" numeric NOT NULL CHECK (days > 0),
 "delivered_on" date NOT NULL,
 "delivery_method" text NOT NULL CHECK (delivery_method IN ('in_person','letter','email','other')),
 "delivery_details" text,
 "deadline" timestamp with time zone NOT NULL,
 "timezone" text NOT NULL,
 "requested_to_take_leave" boolean NOT NULL CHECK (requested_to_take_leave),
 "warned_of_lapse" boolean NOT NULL CHECK (warned_of_lapse),
 "supporting_documents" text,
 "attested_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 "attested_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "vacation_external_leave_notice_details_check" CHECK (delivery_method <> 'other' OR length(btrim(coalesce(delivery_details, ''))) > 0),
 CONSTRAINT "vacation_external_leave_notice_year_check" CHECK (leave_year <= extract(year FROM delivered_on)),
 FOREIGN KEY (employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_external_leave_notice_org_id_idx" ON "vacation_external_leave_notice" (id,organization_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacation_external_leave_notice_employee_idx" ON "vacation_external_leave_notice" (organization_id,employee_id,leave_year);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vacation_leave_opportunity_assessment" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "external_notice_id" uuid NOT NULL,
 "basis" text NOT NULL CHECK (length(btrim(basis)) > 0),
 "assessed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 "assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
 FOREIGN KEY (external_notice_id,organization_id) REFERENCES vacation_external_leave_notice(id,organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_leave_opportunity_assessment_notice_idx" ON "vacation_leave_opportunity_assessment" (external_notice_id);
--> statement-breakpoint
-- Only the foreign key clearing a deleted user may touch a final record.
CREATE OR REPLACE FUNCTION "vacation_leave_notice_record_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	author text := TG_ARGV[0];
BEGIN
	IF (to_jsonb(NEW) - author) IS DISTINCT FROM (to_jsonb(OLD) - author)
		OR (to_jsonb(NEW) ->> author IS NOT NULL AND to_jsonb(NEW) ->> author IS DISTINCT FROM to_jsonb(OLD) ->> author)
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '55000',
			MESSAGE = format('A %s is final', replace(TG_TABLE_NAME, '_', ' '));
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "vacation_external_leave_notice_guard" ON "vacation_external_leave_notice";
--> statement-breakpoint
CREATE TRIGGER "vacation_external_leave_notice_guard"
BEFORE UPDATE ON "vacation_external_leave_notice"
FOR EACH ROW EXECUTE FUNCTION "vacation_leave_notice_record_guard"('attested_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "vacation_leave_opportunity_assessment_guard" ON "vacation_leave_opportunity_assessment";
--> statement-breakpoint
CREATE TRIGGER "vacation_leave_opportunity_assessment_guard"
BEFORE UPDATE ON "vacation_leave_opportunity_assessment"
FOR EACH ROW EXECUTE FUNCTION "vacation_leave_notice_record_guard"('assessed_by');
