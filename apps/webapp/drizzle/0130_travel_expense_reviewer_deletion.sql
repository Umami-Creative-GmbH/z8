-- Review history never blocks deleting a reviewer (spec #598 review): the actor of a closed
-- report cycle (#603/#614) and the last updater of a report or item are kept by value and
-- cleared when that employee or user is deleted. Maintenance purges a cycle's closure with
-- the approval lifecycle it belongs to.
ALTER TABLE "travel_expense_report_cycle_closure" DROP CONSTRAINT "travel_expense_report_cycle_closure_actor_fk";--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" DROP CONSTRAINT "travel_expense_report_cycle_closure_actor_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ALTER COLUMN "actor_employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_actor_fk" FOREIGN KEY ("actor_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE SET NULL ("actor_employee_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_cycle_closure" ADD CONSTRAINT "travel_expense_report_cycle_closure_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report" DROP CONSTRAINT "travel_expense_report_updated_by_user_id_fk";--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" DROP CONSTRAINT "travel_expense_report_item_updated_by_user_id_fk";--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A deleted report's receipt objects that only its frozen submissions still named (removed
-- from a returned report, #603) are queued for cleanup too, unless a live receipt row or a
-- frozen submission of another report still names the object (adjustment copies, #615).
CREATE OR REPLACE FUNCTION "travel_expense_report_enqueue_frozen_receipt_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "travel_expense_receipt_upload" (
		"id", "organization_id", "report_id", "item_id", "uploaded_by", "storage_key",
		"storage_bucket", "storage_version_id", "status", "reason", "next_attempt_at",
		"created_at", "updated_at"
	)
	SELECT DISTINCT ON (frozen."storage_key")
		frozen."receipt_id", OLD."organization_id", OLD."id", frozen."item_id", OLD."employee_id",
		frozen."storage_key", frozen."storage_bucket", frozen."storage_version_id",
		'cleanup_required', 'removed', now(), now(), now()
	FROM (
		SELECT
			(receipt->>'receiptId')::uuid AS "receipt_id",
			(item->>'itemId')::uuid AS "item_id",
			receipt->'object'->>'key' AS "storage_key",
			receipt->'object'->>'bucket' AS "storage_bucket",
			receipt->'object'->>'versionId' AS "storage_version_id"
		FROM "approval_submitted_revision" s,
			jsonb_array_elements(CASE WHEN jsonb_typeof(s."facts"->'items') = 'array' THEN s."facts"->'items' ELSE '[]'::jsonb END) item,
			jsonb_array_elements(CASE WHEN jsonb_typeof(item->'receipts') = 'array' THEN item->'receipts' ELSE '[]'::jsonb END) receipt
		WHERE s."organization_id" = OLD."organization_id"
			AND s."source_type" = 'travel_expense_report'
			AND s."source_id" = OLD."id"
			AND receipt->'object'->>'key' IS NOT NULL
			AND receipt->>'receiptId' IS NOT NULL
			AND item->>'itemId' IS NOT NULL
	) frozen
	WHERE NOT EXISTS (
		SELECT 1 FROM "travel_expense_report_receipt" live
		WHERE live."organization_id" = OLD."organization_id" AND live."storage_key" = frozen."storage_key"
	) AND NOT EXISTS (
		SELECT 1
		FROM "approval_submitted_revision" other
		JOIN "travel_expense_report" other_report
			ON other_report."organization_id" = other."organization_id" AND other_report."id" = other."source_id",
			jsonb_array_elements(CASE WHEN jsonb_typeof(other."facts"->'items') = 'array' THEN other."facts"->'items' ELSE '[]'::jsonb END) other_item,
			jsonb_array_elements(CASE WHEN jsonb_typeof(other_item->'receipts') = 'array' THEN other_item->'receipts' ELSE '[]'::jsonb END) other_receipt
		WHERE other."organization_id" = OLD."organization_id"
			AND other."source_type" = 'travel_expense_report'
			AND other."source_id" <> OLD."id"
			AND other_receipt->'object'->>'key' = frozen."storage_key"
	)
	ORDER BY frozen."storage_key"
	ON CONFLICT DO NOTHING;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "travel_expense_report_frozen_receipt_cleanup" AFTER DELETE ON "travel_expense_report" FOR EACH ROW EXECUTE FUNCTION "travel_expense_report_enqueue_frozen_receipt_cleanup"();
