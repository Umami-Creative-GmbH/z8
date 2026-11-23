-- #1992: § 12 Abs. 3 TzBfG measures call-in notice from the shift's publication or its last
-- material assignment change (assignee, day, start or end). Existing shifts start from their
-- creation instant, the earliest moment their current assignment can have been communicated.
ALTER TABLE "shift" ADD COLUMN IF NOT EXISTS "assignment_changed_at" timestamp;--> statement-breakpoint
UPDATE "shift" SET "assignment_changed_at" = "created_at" WHERE "assignment_changed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "shift" ALTER COLUMN "assignment_changed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shift" ALTER COLUMN "assignment_changed_at" SET NOT NULL;
