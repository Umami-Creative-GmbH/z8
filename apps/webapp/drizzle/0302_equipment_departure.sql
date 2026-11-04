ALTER TABLE equipment_assignment ADD COLUMN departure_deadline date;
--> statement-breakpoint
ALTER TABLE equipment_assignment ADD COLUMN departure_id uuid;
--> statement-breakpoint
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_departure_org_fk
 FOREIGN KEY (departure_id, organization_id) REFERENCES employee_departure(id, organization_id);
--> statement-breakpoint
ALTER TABLE equipment_assignment DROP CONSTRAINT equipment_assignment_deadline_check;
--> statement-breakpoint
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_deadline_check
 CHECK (return_required OR (explicit_deadline IS NULL AND departure_deadline IS NULL));
