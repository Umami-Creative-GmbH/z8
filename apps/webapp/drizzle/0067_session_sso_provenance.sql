CREATE TABLE "session_sso_provenance" (
	"session_id" text PRIMARY KEY NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"provider_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "session_sso_provenance_organization_id_idx" ON "session_sso_provenance" ("organization_id");
