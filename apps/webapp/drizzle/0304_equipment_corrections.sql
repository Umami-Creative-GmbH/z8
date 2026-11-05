ALTER TABLE equipment_handover ADD COLUMN effective jsonb;
ALTER TABLE equipment_exception ADD COLUMN effective jsonb;
ALTER TABLE equipment_handover ADD CONSTRAINT equipment_handover_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE equipment_handover ADD CONSTRAINT equipment_handover_id_org_assignment_unique UNIQUE (id, organization_id, assignment_id);
--> statement-breakpoint
CREATE TABLE equipment_correction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 assignment_id uuid NOT NULL,
 handover_id uuid,
 exception_id uuid,
 expected_revision integer NOT NULL,
 reason text NOT NULL,
 before jsonb NOT NULL,
 after jsonb NOT NULL,
 actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT equipment_correction_assignment_org_fk FOREIGN KEY(assignment_id,organization_id) REFERENCES equipment_assignment(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_correction_handover_org_fk FOREIGN KEY(handover_id,organization_id,assignment_id) REFERENCES equipment_handover(id,organization_id,assignment_id) ON DELETE CASCADE,
 CONSTRAINT equipment_correction_exception_org_fk FOREIGN KEY(exception_id,organization_id,assignment_id) REFERENCES equipment_exception(id,organization_id,assignment_id) ON DELETE CASCADE,
 CONSTRAINT equipment_correction_assignment_revision_unique UNIQUE(organization_id,assignment_id,expected_revision),
 CONSTRAINT equipment_correction_revision_positive CHECK(expected_revision > 0),
 CONSTRAINT equipment_correction_reason_check CHECK(length(btrim(reason)) BETWEEN 1 AND 4000),
 CONSTRAINT equipment_correction_target_check CHECK((handover_id IS NULL) <> (exception_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE equipment_transfer (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 PRIMARY KEY(organization_id,receipt_id,issue_id),
 CONSTRAINT equipment_transfer_receipt_org_fk FOREIGN KEY(receipt_id,organization_id) REFERENCES equipment_handover(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_transfer_issue_org_fk FOREIGN KEY(issue_id,organization_id) REFERENCES equipment_handover(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_transfer_distinct_check CHECK(receipt_id <> issue_id)
);
--> statement-breakpoint
-- Earlier transfers share one actor/UTC transaction instant. Preserve every plausible
-- edge when old data is ambiguous: subsequent amendments must satisfy all of them.
INSERT INTO equipment_transfer(organization_id,receipt_id,issue_id)
SELECT r.organization_id,r.id,i.id FROM equipment_handover r
JOIN equipment_handover i ON i.organization_id=r.organization_id AND i.kind='issue'
 AND i.recorded_at=r.recorded_at AND i.actor_id IS NOT DISTINCT FROM r.actor_id
 AND i.quantity=r.quantity AND i.assignment_id<>r.assignment_id
JOIN equipment_assignment src ON src.id=r.assignment_id AND src.organization_id=r.organization_id
JOIN equipment_assignment dst ON dst.id=i.assignment_id AND dst.organization_id=i.organization_id
WHERE r.kind='receipt' AND r.exception_id IS NULL
 AND src.type_id=dst.type_id AND src.item_id IS NOT DISTINCT FROM dst.item_id
 AND src.employee_id IS DISTINCT FROM dst.employee_id
 AND NOT i.historical AND i.actual_date>=r.actual_date
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE equipment_exception DROP CONSTRAINT equipment_exception_received_check;
ALTER TABLE equipment_exception ADD CONSTRAINT equipment_exception_received_check
 CHECK(received_quantity >= 0 AND received_quantity <= coalesce((effective->>'quantity')::integer,quantity));
--> statement-breakpoint
-- Stable custody order even for handovers recorded on the same UTC instant.
ALTER TABLE equipment_handover ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
