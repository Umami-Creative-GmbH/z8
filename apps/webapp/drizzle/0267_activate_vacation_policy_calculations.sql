-- Assignment management, readers, accrual and carryover now share the dated policy contract.
-- Keep known-history baselines and all posted amounts unchanged.
ALTER TABLE "vacation_policy_rollout" ALTER COLUMN "calculations_enabled" SET DEFAULT true;
--> statement-breakpoint
UPDATE "vacation_policy_rollout" SET "calculations_enabled" = true WHERE "calculations_enabled" = false;
