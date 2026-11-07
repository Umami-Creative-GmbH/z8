-- #1629 (spec #1590, Organization ADR 0011): member removal and SCIM
-- deprovisioning are deactivations. Their hooks record a pending
-- `employee_deactivation` row; a follow-up deactivation applies it, or
-- withdraws it when the person came back first. Existing rows are applied.
ALTER TABLE "employee_deactivation" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_deactivation" DROP CONSTRAINT IF EXISTS "employeeDeactivation_reason_check";--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD CONSTRAINT "employeeDeactivation_reason_check" CHECK (reason IN ('employee_deactivated', 'employee_deactivation_backfill', 'member_removed', 'scim_deprovisioned'));--> statement-breakpoint
ALTER TABLE "employee_deactivation" DROP CONSTRAINT IF EXISTS "employeeDeactivation_status_check";--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD CONSTRAINT "employeeDeactivation_status_check" CHECK (status IN ('pending', 'applied', 'withdrawn'));--> statement-breakpoint
-- A withdrawn deactivation was ended by the person coming back: it is never open.
ALTER TABLE "employee_deactivation" DROP CONSTRAINT IF EXISTS "employeeDeactivation_withdrawn_check";--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD CONSTRAINT "employeeDeactivation_withdrawn_check" CHECK (status <> 'withdrawn' OR reactivated_at IS NOT NULL);--> statement-breakpoint
-- The follow-up scan reads pending rows oldest first.
CREATE INDEX IF NOT EXISTS "employeeDeactivation_pending_idx" ON "employee_deactivation" USING btree ("created_at","organization_id","id") WHERE status = 'pending';
