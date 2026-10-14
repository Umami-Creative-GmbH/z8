-- Employment terms carry the hourly wage as a number (#1174, Organization ADR 0002), like the
-- other wage columns. Existing text wages convert unchanged; an empty or blank wage becomes null.
ALTER TABLE "employee_employment_history" ALTER COLUMN "hourly_rate" SET DATA TYPE numeric(10,2) USING NULLIF(btrim("hourly_rate"), '')::numeric(10,2);
