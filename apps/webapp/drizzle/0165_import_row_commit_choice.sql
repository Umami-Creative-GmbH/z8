-- Reviewed-import commit choice (#906, spec #768 Billable Time: customer import).
-- An accepted staged row creates its record; a customer row from the accounting
-- connection can instead be linked to an existing Z8 customer. The reviewer's
-- choice is stored on the row as {"kind":"link","targetId":"<customer id>"};
-- null keeps the existing meaning (accepted = create, rejected = skip).
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
ALTER TABLE "import_staged_row" ADD COLUMN IF NOT EXISTS "commit_choice" jsonb;
