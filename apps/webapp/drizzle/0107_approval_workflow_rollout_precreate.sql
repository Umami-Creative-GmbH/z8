-- #359: pre-create the approval rollout row of every existing organization and
-- workflow type, so no organization's first approval write bootstraps its row
-- in the write gate and holds same-organization writers behind it. New
-- organizations get their rows in their creation transaction.
-- Rows start legacy/legacy, exactly like the write gate's fail-safe insert.
-- Existing rows and their modes are never changed; re-running inserts nothing.
-- The workflow-type list mirrors APPROVAL_WORKFLOW_TYPES (drizzle-migrations.test.ts).
INSERT INTO "approval_workflow_rollout" ("organization_id", "workflow_type", "lifecycle_mode", "side_effect_mode", "updated_at")
SELECT "organization"."id", "workflow_types"."workflow_type", 'legacy', 'legacy', now()
FROM "organization"
CROSS JOIN unnest(ARRAY['absence', 'time_correction', 'manual_time_submission', 'policy_clock_out', 'travel_expense', 'shift_request', 'compliance_exception']::"approval_workflow_type"[]) AS "workflow_types"("workflow_type")
ON CONFLICT ("organization_id", "workflow_type") DO NOTHING;
