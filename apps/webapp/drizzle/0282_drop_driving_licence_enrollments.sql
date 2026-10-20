-- #1424 (spec #1418, Organization ADR 0005): intended-driver assignments replaced driving licence
-- enrollments, and 0281 copied every enrollment into an employee-level Required assignment, so the
-- enrollment table goes. Dropping the table drops its unique key, foreign keys and index with it.
-- IF EXISTS lets the migration run again.
DROP TABLE IF EXISTS "driving_licence_participant";
