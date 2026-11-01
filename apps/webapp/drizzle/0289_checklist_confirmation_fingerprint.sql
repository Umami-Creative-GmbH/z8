-- #1516: a manual checklist confirmation stores a fingerprint of the configuration
-- it covers. Existing rows keep null: confirmed before change tracking.
ALTER TABLE "implementation_checklist_manual_state" ADD COLUMN "configuration_fingerprint" text;
