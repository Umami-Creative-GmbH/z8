CREATE INDEX IF NOT EXISTS "timeEntry_latestClockActivity_idx"
	ON "time_entry" USING btree ("organization_id", "employee_id", "timestamp" DESC, "id" DESC)
	WHERE "is_superseded" = false AND "type" IN ('clock_in', 'clock_out');
