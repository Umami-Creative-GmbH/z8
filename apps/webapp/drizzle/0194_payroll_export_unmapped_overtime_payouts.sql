-- #1001 (spec #804): the overtime payouts a DATEV, Lexware or Sage payroll file
-- left out because no wage type is mapped to the "overtime" special category for
-- its format. The export reports them; earlier jobs have none.
ALTER TABLE "payroll_export_job" ADD COLUMN IF NOT EXISTS "unmapped_overtime_payouts" jsonb DEFAULT '[]'::jsonb NOT NULL;
