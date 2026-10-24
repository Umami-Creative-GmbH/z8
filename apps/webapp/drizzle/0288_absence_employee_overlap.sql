-- #1474: measured employee-owned overlap lookup, including legacy-null orgs
-- and all statuses. See docs/performance/1448-absence-indexes.md for evidence
-- and the concurrent prebuild procedure for a busy database. Drizzle runs this
-- migration in a transaction, so CONCURRENTLY cannot be used here.
CREATE INDEX IF NOT EXISTS "absenceEntry_employeeId_endDate_startDate_idx"
	ON "absence_entry" USING btree ("employee_id", "end_date", "start_date");
