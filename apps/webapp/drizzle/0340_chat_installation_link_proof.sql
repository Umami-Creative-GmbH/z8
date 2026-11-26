-- #2042 / #2037: Installation-scoped, digest-only chat link proofs, rate-limit counters,
-- and installation-scoped member links with candidate enrollment segregation.
CREATE TABLE IF NOT EXISTS "chat_installation_link_proof" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"installation_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"employee_id" uuid NOT NULL,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_external_user_id" text,
	"revoked_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"rate_limit_window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_installation_link_proof_installation_fk" FOREIGN KEY ("installation_id", "organization_id") REFERENCES "chat_installation"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_link_proof_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_link_proof_purpose_check" CHECK ("purpose" IN ('member_link', 'candidate_enrollment')),
	CONSTRAINT "chat_installation_link_proof_digest_check" CHECK (length("code_digest") = 64),
	CONSTRAINT "chat_installation_link_proof_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationLinkProof_inst_purpose_digest_unique_idx"
	ON "chat_installation_link_proof" USING btree ("installation_id", "purpose", "code_digest");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationLinkProof_org_inst_user_purpose_idx"
	ON "chat_installation_link_proof" USING btree ("organization_id", "installation_id", "user_id", "purpose", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationLinkProof_org_inst_expires_idx"
	ON "chat_installation_link_proof" USING btree ("organization_id", "installation_id", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation_link_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"installation_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"actor_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"rate_limit_window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_installation_link_attempt_installation_fk" FOREIGN KEY ("installation_id", "organization_id") REFERENCES "chat_installation"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_link_attempt_purpose_check" CHECK ("purpose" IN ('member_link', 'candidate_enrollment')),
	CONSTRAINT "chat_installation_link_attempt_actor_key_check" CHECK (length(btrim("actor_key")) > 0),
	CONSTRAINT "chat_installation_link_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationLinkAttempt_org_inst_purpose_actor_unique_idx"
	ON "chat_installation_link_attempt" USING btree ("organization_id", "installation_id", "purpose", "actor_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation_member_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"installation_id" uuid NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"employee_id" uuid,
	"external_user_id" text NOT NULL,
	"external_username" text,
	"external_display_name" text,
	"external_scope" text NOT NULL,
	"provenance" text NOT NULL,
	"is_candidate_enrollment" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_installation_member_link_installation_fk" FOREIGN KEY ("installation_id", "organization_id") REFERENCES "chat_installation"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_member_link_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id"),
	CONSTRAINT "chat_installation_member_link_provenance_check" CHECK ("provenance" IN ('link_proof', 'verified_same_scope_reuse', 'legacy_backfill')),
	CONSTRAINT "chat_installation_member_link_external_user_id_check" CHECK (length(btrim("external_user_id")) > 0),
	CONSTRAINT "chat_installation_member_link_external_scope_check" CHECK (length(btrim("external_scope")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationMemberLink_inst_user_lane_active_unique_idx"
	ON "chat_installation_member_link" USING btree ("installation_id", "user_id", "is_candidate_enrollment")
	WHERE "is_active" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationMemberLink_inst_ext_user_lane_active_unique_idx"
	ON "chat_installation_member_link" USING btree ("installation_id", "external_user_id", "is_candidate_enrollment")
	WHERE "is_active" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationMemberLink_org_inst_lane_active_idx"
	ON "chat_installation_member_link" USING btree ("organization_id", "installation_id", "is_candidate_enrollment", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationMemberLink_org_user_lane_active_idx"
	ON "chat_installation_member_link" USING btree ("organization_id", "user_id", "is_candidate_enrollment", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationMemberLink_org_scope_user_idx"
	ON "chat_installation_member_link" USING btree ("organization_id", "external_scope", "user_id");
