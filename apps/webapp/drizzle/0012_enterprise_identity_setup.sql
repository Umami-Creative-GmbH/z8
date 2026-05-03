DO $$ BEGIN
	CREATE TYPE "public"."enterprise_identity_preset" AS ENUM('okta', 'microsoft-entra', 'google-workspace', 'generic');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."enterprise_identity_protocol" AS ENUM('oidc', 'saml');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."enterprise_identity_setup_step" AS ENUM('provider', 'domain', 'sso', 'ssoTest', 'scim', 'accessPolicy', 'review');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_identity_setup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"preset" "enterprise_identity_preset",
	"protocol" "enterprise_identity_protocol",
	"provider_id" text,
	"current_step" "enterprise_identity_setup_step" DEFAULT 'provider' NOT NULL,
	"domain" text,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"sso_test" jsonb DEFAULT '{"status":"not-run","testEmail":null,"providerId":null,"checkedAt":null,"error":null}'::jsonb NOT NULL,
	"scim" jsonb DEFAULT '{"enabled":false,"providerId":null,"verified":false,"lastCheckedAt":null,"error":null}'::jsonb NOT NULL,
	"enforcement" jsonb DEFAULT '{"ssoRequired":false,"domainRestrictionEnabled":false,"inviteRestrictionEnabled":false}'::jsonb NOT NULL,
	"default_role_template_id" uuid DEFAULT NULL,
	"activated" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "enterprise_identity_setup_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "enterprise_identity_setup_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "enterprise_identity_setup_default_role_template_id_role_template_id_fk" FOREIGN KEY ("default_role_template_id") REFERENCES "public"."role_template"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "enterprise_identity_setup_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "enterprise_identity_setup_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterpriseIdentitySetup_organizationId_idx" ON "enterprise_identity_setup" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterpriseIdentitySetup_providerId_idx" ON "enterprise_identity_setup" USING btree ("provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterpriseIdentitySetup_currentStep_idx" ON "enterprise_identity_setup" USING btree ("current_step");
