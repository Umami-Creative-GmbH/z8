-- #1935 (final review): an External Contractor invitation may carry the engagement's first
-- compensation terms. The invitation stores them parsed (the shape of the
-- contractor_compensation_terms columns); joining writes them as the new contractor engagement's
-- first terms from its start. Only a contractor draft carries them.
ALTER TABLE "employee_invitation_draft" ADD COLUMN IF NOT EXISTS "contractor_compensation" jsonb;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	DROP CONSTRAINT IF EXISTS "employeeInvitationDraft_contractor_compensation_check";
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	ADD CONSTRAINT "employeeInvitationDraft_contractor_compensation_check"
	CHECK (
		"contractor_compensation" IS NULL
		OR ("engagement_kind" = 'contractor' AND jsonb_typeof("contractor_compensation") = 'object')
	);
