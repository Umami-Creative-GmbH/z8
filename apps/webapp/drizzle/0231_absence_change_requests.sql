ALTER TYPE "approval_workflow_type" ADD VALUE IF NOT EXISTS 'absence_change';
--> statement-breakpoint
CREATE TABLE "absence_change_request" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "absence_id" uuid NOT NULL,
 "kind" text NOT NULL CHECK (kind IN ('change', 'cancel')),
 "status" text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'obsolete', 'expired')),
 "original" jsonb NOT NULL,
 "proposed" jsonb,
 "reason" text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
 "approval_workflow_id" uuid,
 "submitted_by" text NOT NULL REFERENCES "user"("id"),
 "created_at" timestamptz NOT NULL DEFAULT now(),
 "decided_at" timestamptz,
 "decided_by" text REFERENCES "user"("id"),
 "decision_reason" text,
 FOREIGN KEY (employee_id, organization_id) REFERENCES employee(id, organization_id) ON DELETE CASCADE,
 FOREIGN KEY (approval_workflow_id, organization_id) REFERENCES approval_workflow(id, organization_id),
 CHECK ((kind = 'cancel' AND proposed IS NULL) OR (kind = 'change' AND proposed IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "absenceChangeRequest_pending_idx" ON absence_change_request(organization_id, absence_id) WHERE status = 'pending';
CREATE INDEX "absenceChangeRequest_employee_history_idx" ON absence_change_request(organization_id, employee_id, created_at);
