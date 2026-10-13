-- Skill expiry date as a plain last-valid day (#1142). The assign dialog stored midnight UTC of
-- the picked day in a timestamp without time zone, so each value's calendar day is the day the
-- user picked. Keep that day; the skill now stays valid through it. Null (never expires) stays null.
ALTER TABLE "employee_skill" ALTER COLUMN "expires_at" SET DATA TYPE date USING "expires_at"::date;
