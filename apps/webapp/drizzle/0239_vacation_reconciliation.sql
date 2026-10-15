CREATE TABLE "vacation_reconciliation" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "plan" jsonb NOT NULL,
 "fingerprint" text NOT NULL,
 "reviewed_by" text NOT NULL REFERENCES "user"("id"),
 "status" text DEFAULT 'reviewed' NOT NULL CHECK (status IN ('reviewed','committed')),
 "result" jsonb,
 "created_at" timestamp DEFAULT now() NOT NULL,
 "committed_at" timestamp
);
CREATE INDEX "vacationReconciliation_org_status_idx" ON "vacation_reconciliation" ("organization_id","status");
