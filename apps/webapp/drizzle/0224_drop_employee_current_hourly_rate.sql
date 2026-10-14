-- Employment terms are the only wage history (#1179, Organization ADR 0002). 0223 merged the
-- rate history into the terms, and every wage reader and writer now uses the terms, so the
-- denormalized copy on the employee goes. employee_invitation_draft keeps its own wage: it
-- feeds the employee's first terms.
ALTER TABLE "employee" DROP COLUMN IF EXISTS "current_hourly_rate";
