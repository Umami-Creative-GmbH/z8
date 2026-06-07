CREATE TABLE IF NOT EXISTS "organization_notification_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "default_language" text DEFAULT 'en' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_notification_settings_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade,
  CONSTRAINT "organization_notification_settings_organization_id_unique"
    UNIQUE ("organization_id")
);

CREATE INDEX IF NOT EXISTS "organizationNotificationSettings_organizationId_idx"
  ON "organization_notification_settings" ("organization_id");
