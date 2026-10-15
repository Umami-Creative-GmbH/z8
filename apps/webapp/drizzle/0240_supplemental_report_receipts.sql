CREATE TABLE "travel_expense_report_supplemental_receipt" (
 "id" uuid PRIMARY KEY NOT NULL,
 "organization_id" text NOT NULL,
 "report_id" uuid NOT NULL,
 "item_id" uuid NOT NULL,
 "submission_cycle" integer NOT NULL,
 "receipt" jsonb NOT NULL,
 "file_name" text NOT NULL,
 "uploaded_by" uuid NOT NULL,
 "uploaded_by_name" text NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "travel_expense_supplemental_receipt_cycle_check" CHECK (submission_cycle > 0),
 CONSTRAINT "travel_expense_supplemental_receipt_report_fk" FOREIGN KEY (report_id,organization_id) REFERENCES travel_expense_report(id,organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseSupplementalReceipt_item_cycle_idx" ON travel_expense_report_supplemental_receipt (organization_id,report_id,item_id,submission_cycle);
--> statement-breakpoint
-- Keep the document independently of later item edits and employee offboarding.
CREATE FUNCTION travel_expense_supplemental_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Supplemental receipt evidence cannot be changed';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER travel_expense_supplemental_receipt_no_update BEFORE UPDATE ON travel_expense_report_supplemental_receipt FOR EACH ROW EXECUTE FUNCTION travel_expense_supplemental_receipt_immutable();
--> statement-breakpoint
CREATE FUNCTION travel_expense_supplemental_receipt_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO travel_expense_receipt_upload (id,organization_id,report_id,item_id,uploaded_by,storage_key,storage_bucket,storage_version_id,status,reason,next_attempt_at,created_at,updated_at)
 VALUES (OLD.id,OLD.organization_id,OLD.report_id,OLD.item_id,OLD.uploaded_by,OLD.receipt->'object'->>'key',OLD.receipt->'object'->>'bucket',OLD.receipt->'object'->>'versionId','cleanup_required','removed',now(),now(),now())
 ON CONFLICT DO NOTHING;
 RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER travel_expense_supplemental_receipt_cleanup AFTER DELETE ON travel_expense_report_supplemental_receipt FOR EACH ROW EXECUTE FUNCTION travel_expense_supplemental_receipt_cleanup();
