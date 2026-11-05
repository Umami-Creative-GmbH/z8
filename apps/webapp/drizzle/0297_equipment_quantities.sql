-- Preserve existing individual agreements and physical receipt state.
ALTER TABLE equipment_item ADD CONSTRAINT equipment_item_id_org_type_unique UNIQUE(id, organization_id, type_id);
ALTER TABLE equipment_assignment ADD COLUMN type_id uuid;
ALTER TABLE equipment_assignment ADD COLUMN quantity integer NOT NULL DEFAULT 1;
ALTER TABLE equipment_assignment ADD COLUMN received_quantity integer NOT NULL DEFAULT 0;
UPDATE equipment_assignment a SET type_id = i.type_id, received_quantity = CASE WHEN a.received THEN 1 ELSE 0 END
FROM equipment_item i WHERE i.id = a.item_id AND i.organization_id = a.organization_id;
ALTER TABLE equipment_assignment ALTER COLUMN type_id SET NOT NULL;
ALTER TABLE equipment_assignment ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE equipment_assignment DROP CONSTRAINT equipment_assignment_item_org_fk;
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_item_org_fk FOREIGN KEY(item_id, organization_id, type_id) REFERENCES equipment_item(id, organization_id, type_id);
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_type_org_fk FOREIGN KEY(type_id, organization_id) REFERENCES equipment_type(id, organization_id);
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_quantity_check CHECK(quantity > 0 AND (item_id IS NULL OR quantity = 1));
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_received_quantity_check CHECK(received_quantity >= 0 AND received_quantity <= quantity);
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_received_check CHECK(received = (received_quantity = quantity));
--> statement-breakpoint
ALTER TABLE equipment_handover ADD COLUMN quantity integer NOT NULL DEFAULT 1;
ALTER TABLE equipment_handover ADD CONSTRAINT equipment_handover_quantity_positive CHECK(quantity > 0);
ALTER TABLE equipment_handover DROP CONSTRAINT equipment_handover_individual_once;
CREATE UNIQUE INDEX equipment_handover_issue_once ON equipment_handover(organization_id, assignment_id) WHERE kind = 'issue';
