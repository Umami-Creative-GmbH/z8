-- Organization and other auth targets use text IDs; existing UUID targets keep
-- their canonical string representation. The entity type/ID index is retained.
ALTER TABLE "audit_log" ALTER COLUMN "entity_id" TYPE text USING "entity_id"::text;
