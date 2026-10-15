CREATE TABLE "organization_tracking_settings" (
 "organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "tracking_start_date" date NOT NULL,
 "activated_at" timestamp with time zone,
 "activated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 "revision" integer DEFAULT 1 NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 CONSTRAINT "organization_tracking_settings_revision_check" CHECK ("revision" >= 1)
);
-- Existing organizations deliberately receive no row: activation requires a reviewed admin operation.
