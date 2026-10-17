CREATE TABLE IF NOT EXISTS "vacation_carryover_transfer" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "source_year" integer NOT NULL,
 "allowance_id" uuid REFERENCES "employee_vacation_allowance"("id") ON DELETE SET NULL,
 "outcome" text NOT NULL CHECK (outcome IN ('generated','legacy_preserved')),
 "days" numeric NOT NULL CHECK (days >= 0),
 "original_days" numeric NOT NULL CHECK (original_days >= 0),
 "expiry_date" timestamp with time zone,
 "timezone" text NOT NULL,
 "source_policy_id" uuid,
 "receiving_policy_id" uuid,
 "performed_by" text NOT NULL,
 "reviewed_at" timestamp with time zone,
 "expired_by" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "expired_at" timestamp with time zone,
 FOREIGN KEY (employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_carryover_transfer_employee_source_idx" ON "vacation_carryover_transfer" (employee_id,source_year);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacation_carryover_transfer_org_idx" ON "vacation_carryover_transfer" (organization_id,source_year);
