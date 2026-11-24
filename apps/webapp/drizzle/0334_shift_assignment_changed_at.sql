-- #1992: § 12 Abs. 3 TzBfG measures call-in notice from the shift's publication or its last
-- material assignment change (assignee, day, start or end), whichever is later.
-- Backfill: rows before this migration never recorded when their assignment last changed, only
-- `created_at`, `published_at` and `updated_at`. The latest of the three is the conservative
-- choice: a shift reassigned or moved after publication gets at most the notice it really had,
-- never more (an unrelated later edit only understates notice, which an admin can acknowledge).
-- The `updated_at` term is capped at the shift's day (`date`, its organization-local midnight):
-- the live writer never re-stamps a shift once it has started, and an edit after the shift (a
-- note, an end-time correction) must not move the stamp past its end, which would read as work
-- recorded after the fact and drop a genuine short-notice finding. Any change on the shift's day
-- gives the same notification day, so midnight is as good as the start time here.
-- A draft gets its last edit; its notice runs from its later publication anyway. GREATEST and
-- LEAST ignore NULLs. Rows that already have a value are left alone (idempotent).
ALTER TABLE "shift" ADD COLUMN IF NOT EXISTS "assignment_changed_at" timestamp;--> statement-breakpoint
UPDATE "shift" SET "assignment_changed_at" = GREATEST("created_at", "published_at", LEAST("updated_at", "date")) WHERE "assignment_changed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "shift" ALTER COLUMN "assignment_changed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shift" ALTER COLUMN "assignment_changed_at" SET NOT NULL;
