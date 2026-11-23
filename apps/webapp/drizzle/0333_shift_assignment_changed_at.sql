-- #1992: § 12 Abs. 3 TzBfG measures call-in notice from the shift's publication or its last
-- material assignment change (assignee, day, start or end), whichever is later.
-- Backfill: rows before this migration never recorded when their assignment last changed, only
-- `created_at`, `published_at` and `updated_at`. The latest of the three is the conservative
-- choice: a shift reassigned or moved after publication gets at most the notice it really had,
-- never more (an unrelated later edit only understates notice, which an admin can acknowledge).
-- A draft gets its last edit; its notice runs from its later publication anyway. GREATEST
-- ignores a NULL `published_at`. Rows that already have a value are left alone (idempotent).
ALTER TABLE "shift" ADD COLUMN IF NOT EXISTS "assignment_changed_at" timestamp;--> statement-breakpoint
UPDATE "shift" SET "assignment_changed_at" = GREATEST("created_at", "published_at", "updated_at") WHERE "assignment_changed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "shift" ALTER COLUMN "assignment_changed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shift" ALTER COLUMN "assignment_changed_at" SET NOT NULL;
