ALTER TABLE equipment_assignment ADD COLUMN deactivation_id uuid;
--> statement-breakpoint
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_deactivation_org_employee_fk
 FOREIGN KEY (deactivation_id, organization_id, employee_id)
 REFERENCES employee_deactivation(id, organization_id, employee_id);
