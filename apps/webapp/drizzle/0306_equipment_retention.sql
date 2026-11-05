ALTER TABLE equipment_assignment ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE equipment_assignment ADD COLUMN case_held boolean NOT NULL DEFAULT false;
ALTER TABLE equipment_handover ADD COLUMN transfer_history_cleaned boolean NOT NULL DEFAULT false;
ALTER TABLE equipment_command ALTER COLUMN fingerprint DROP NOT NULL;
ALTER TABLE equipment_command ALTER COLUMN result DROP NOT NULL;
ALTER TABLE equipment_command ADD CONSTRAINT equipment_command_minimized_check CHECK ((fingerprint IS NULL) = (result IS NULL));
--> statement-breakpoint
UPDATE equipment_assignment a SET last_activity_at = coalesce((SELECT max(at) FROM (
 SELECT recorded_at AS at FROM equipment_handover WHERE organization_id=a.organization_id AND assignment_id=a.id
 UNION ALL SELECT recorded_at FROM equipment_exception WHERE organization_id=a.organization_id AND assignment_id=a.id
 UNION ALL SELECT recorded_at FROM equipment_correction WHERE organization_id=a.organization_id AND assignment_id=a.id
 UNION ALL SELECT updated_at FROM employee_departure WHERE organization_id=a.organization_id AND id=a.departure_id
 UNION ALL SELECT deactivated_at FROM employee_deactivation WHERE organization_id=a.organization_id AND id=a.deactivation_id
) activity), last_activity_at);
--> statement-breakpoint
CREATE TABLE equipment_command_assignment (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, assignment_id uuid NOT NULL,
 PRIMARY KEY (organization_id, request_id, assignment_id),
 FOREIGN KEY (organization_id, request_id) REFERENCES equipment_command(organization_id, request_id) ON DELETE CASCADE,
 FOREIGN KEY (assignment_id, organization_id) REFERENCES equipment_assignment(id, organization_id) ON DELETE CASCADE
);
INSERT INTO equipment_command_assignment SELECT c.organization_id, c.request_id, a.id
 FROM equipment_command c JOIN equipment_assignment a ON a.organization_id=c.organization_id AND a.id::text=c.result->>'id';
-- Old transfer command receipts point at the destination; include their source too.
INSERT INTO equipment_command_assignment
 SELECT DISTINCT c.organization_id, c.request_id, source.assignment_id FROM equipment_command_assignment c
 JOIN equipment_handover destination ON destination.organization_id=c.organization_id AND destination.assignment_id=c.assignment_id
 JOIN equipment_transfer t ON t.organization_id=c.organization_id AND t.issue_id=destination.id
 JOIN equipment_handover source ON source.organization_id=c.organization_id AND source.id=t.receipt_id
 ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE equipment_item_custody_history (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 item_id uuid NOT NULL, issue_sequence bigint NOT NULL, issue_date date, receipt_date date,
 PRIMARY KEY (organization_id, item_id, issue_sequence),
 FOREIGN KEY (item_id, organization_id) REFERENCES equipment_item(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE equipment_case_hold_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 assignment_id uuid NOT NULL, kind text NOT NULL, reason text NOT NULL,
 actor_id text REFERENCES "user"(id) ON DELETE SET NULL, recorded_at timestamptz NOT NULL, revision integer NOT NULL,
 FOREIGN KEY (assignment_id, organization_id) REFERENCES equipment_assignment(id, organization_id) ON DELETE CASCADE,
 CONSTRAINT equipment_hold_assignment_revision_unique UNIQUE (organization_id, assignment_id, revision),
 CONSTRAINT equipment_hold_kind_check CHECK (kind IN ('place', 'release')),
 CONSTRAINT equipment_hold_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
 CONSTRAINT equipment_hold_revision_positive CHECK (revision > 0)
);
