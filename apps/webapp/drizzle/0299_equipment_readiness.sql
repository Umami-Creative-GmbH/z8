CREATE TABLE "equipment_item_readiness_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL,
  "item_revision" integer NOT NULL,
  "kind" text NOT NULL,
  "actor_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "equipment_readiness_item_org_fk" FOREIGN KEY ("item_id", "organization_id") REFERENCES "equipment_item"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "equipment_readiness_item_revision_unique" UNIQUE ("organization_id", "item_id", "item_revision"),
  CONSTRAINT "equipment_readiness_kind_check" CHECK ("kind" IN ('clearance', 'unavailable', 'retired')),
  CONSTRAINT "equipment_readiness_revision_positive" CHECK ("item_revision" > 0)
);
