-- Spec #1891 review: only files the payroll workspace prepares leave settled days out
-- (#1898). Settings and scheduled exports keep them, as before.
ALTER TABLE "payroll_export_job" ADD COLUMN IF NOT EXISTS "leaves_out_settled_days" boolean DEFAULT false NOT NULL;
