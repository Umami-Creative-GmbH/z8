-- #1361: 0258 declared the grace-period checks inline without names, so PostgreSQL named them
-- organization_mfa_policy_grace_period_days_check and organization_mfa_window_grace_period_days_check.
-- The schema names them organization_mfa_grace_check and organization_mfa_window_grace_check.
-- 0258 already reached main, so rename forward instead of editing it. The rule (0, 7, 14, 30) is unchanged.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organization_mfa_policy'::regclass AND conname = 'organization_mfa_policy_grace_period_days_check')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organization_mfa_policy'::regclass AND conname = 'organization_mfa_grace_check') THEN
  ALTER TABLE organization_mfa_policy RENAME CONSTRAINT organization_mfa_policy_grace_period_days_check TO organization_mfa_grace_check;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organization_mfa_policy'::regclass AND conname = 'organization_mfa_grace_check') THEN
  ALTER TABLE organization_mfa_policy ADD CONSTRAINT organization_mfa_grace_check CHECK (grace_period_days IN (0,7,14,30));
 END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organization_mfa_window'::regclass AND conname = 'organization_mfa_window_grace_period_days_check')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organization_mfa_window'::regclass AND conname = 'organization_mfa_window_grace_check') THEN
  ALTER TABLE organization_mfa_window RENAME CONSTRAINT organization_mfa_window_grace_period_days_check TO organization_mfa_window_grace_check;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organization_mfa_window'::regclass AND conname = 'organization_mfa_window_grace_check') THEN
  ALTER TABLE organization_mfa_window ADD CONSTRAINT organization_mfa_window_grace_check CHECK (grace_period_days IN (0,7,14,30));
 END IF;
END $$;
