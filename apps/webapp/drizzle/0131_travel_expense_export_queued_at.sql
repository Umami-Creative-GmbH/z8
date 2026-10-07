-- #613 review: when the current attempt of an export batch was queued (creation or retry).
-- A batch whose job never started (lost queue job, failed claim) becomes retryable once it
-- has waited longer than the stale limit. Null on batches created before this column: the
-- application then falls back to requested_at.
ALTER TABLE "travel_expense_export_batch" ADD COLUMN "queued_at" timestamp with time zone;
