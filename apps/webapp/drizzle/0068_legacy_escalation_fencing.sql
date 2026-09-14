CREATE TABLE "approval_escalation_control" (
	"organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"owner" text DEFAULT 'legacy' NOT NULL,
	"automation_paused" boolean DEFAULT false NOT NULL
);
