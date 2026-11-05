ALTER TABLE equipment_assignment ADD COLUMN exception_received_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE equipment_assignment ADD COLUMN lost_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE equipment_assignment ADD COLUMN waived_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE equipment_assignment ADD CONSTRAINT equipment_assignment_settlement_check CHECK(lost_quantity >= 0 AND waived_quantity >= 0 AND exception_received_quantity >= 0 AND exception_received_quantity <= received_quantity AND exception_received_quantity::bigint <= lost_quantity::bigint + waived_quantity AND received_quantity::bigint + lost_quantity + waived_quantity - exception_received_quantity <= quantity AND (return_required OR (lost_quantity = 0 AND waived_quantity = 0)));
--> statement-breakpoint
CREATE TABLE equipment_exception (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 assignment_id uuid NOT NULL,
 kind text NOT NULL,
 quantity integer NOT NULL,
 received_quantity integer NOT NULL DEFAULT 0,
 reason text NOT NULL,
 actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
 recorded_at timestamp with time zone NOT NULL DEFAULT now(),
 CONSTRAINT equipment_exception_id_org_assignment_unique UNIQUE(id, organization_id, assignment_id),
 CONSTRAINT equipment_exception_assignment_org_fk FOREIGN KEY(assignment_id, organization_id) REFERENCES equipment_assignment(id, organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_exception_kind_check CHECK(kind IN ('lost', 'waived')),
 CONSTRAINT equipment_exception_quantity_positive CHECK(quantity > 0),
 CONSTRAINT equipment_exception_received_check CHECK(received_quantity >= 0 AND received_quantity <= quantity),
 CONSTRAINT equipment_exception_reason_check CHECK(length(btrim(reason)) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE equipment_handover ADD COLUMN exception_id uuid;
ALTER TABLE equipment_handover ADD CONSTRAINT equipment_handover_exception_org_assignment_fk FOREIGN KEY(exception_id, organization_id, assignment_id) REFERENCES equipment_exception(id, organization_id, assignment_id);
ALTER TABLE equipment_handover ADD CONSTRAINT equipment_handover_exception_receipt_check CHECK(exception_id IS NULL OR kind = 'receipt');
