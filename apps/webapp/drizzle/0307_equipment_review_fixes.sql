-- A legacy union cannot prove separate historical teams. Preserve it only for
-- unambiguous endings; ambiguous personal follow-up requires explicit/all grants.
ALTER TABLE equipment_former_team_scope DROP CONSTRAINT equipment_former_team_scope_pkey;
ALTER TABLE equipment_former_team_scope ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
ALTER TABLE equipment_former_team_scope ADD COLUMN ending_id uuid;
WITH endings AS (
 SELECT organization_id,employee_id,id AS context FROM employee_deactivation
 UNION SELECT organization_id,employee_id,id FROM employee_departure WHERE status='effective'
 UNION SELECT organization_id,employee_id,coalesce(deactivation_id,departure_id,employment_period_id) FROM equipment_assignment WHERE coalesce(deactivation_id,departure_id,employment_period_id) IS NOT NULL
), unambiguous AS (
 SELECT organization_id,employee_id,min(context::text)::uuid AS context FROM endings GROUP BY organization_id,employee_id HAVING count(*)=1
)
UPDATE equipment_former_team_scope f SET ending_id=e.context FROM unambiguous e WHERE e.organization_id=f.organization_id AND e.employee_id=f.employee_id;
-- Include earlier endings even when their assignments were already purged: a
-- legacy union cannot be safely attributed to the sole remaining assignment.
WITH endings AS (
 SELECT organization_id,employee_id,id AS context FROM employee_deactivation
 UNION SELECT organization_id,employee_id,id FROM employee_departure WHERE status='effective'
 UNION SELECT organization_id,employee_id,coalesce(deactivation_id,departure_id,employment_period_id) FROM equipment_assignment WHERE coalesce(deactivation_id,departure_id,employment_period_id) IS NOT NULL
), ambiguous AS (
 SELECT organization_id,employee_id FROM endings GROUP BY organization_id,employee_id HAVING count(*)>1
)
DELETE FROM equipment_former_team_scope f USING ambiguous e WHERE e.organization_id=f.organization_id AND e.employee_id=f.employee_id;
ALTER TABLE equipment_former_team_scope ADD CONSTRAINT equipment_former_ending_unique UNIQUE NULLS NOT DISTINCT (organization_id,employee_id,ending_id);
--> statement-breakpoint
CREATE TABLE equipment_custody_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 item_id uuid NOT NULL, item_revision integer NOT NULL, actual_date date NOT NULL, condition text NOT NULL,
 proposed_by text REFERENCES "user"(id) ON DELETE SET NULL, proposed_at timestamptz NOT NULL,
 confirmed_by text REFERENCES "user"(id) ON DELETE SET NULL, confirmed_at timestamptz,
 FOREIGN KEY (item_id,organization_id) REFERENCES equipment_item(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_custody_receipt_revision_unique UNIQUE (organization_id,item_id,item_revision),
 CONSTRAINT equipment_custody_receipt_independent CHECK (proposed_by IS NULL OR confirmed_by IS NULL OR proposed_by <> confirmed_by),
 CONSTRAINT equipment_custody_receipt_condition CHECK (condition IN ('good','worn','damaged','unknown'))
);
