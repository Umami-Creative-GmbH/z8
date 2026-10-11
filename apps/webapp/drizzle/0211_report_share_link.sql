-- Report share links (#806): a secret, expiring URL that shows a frozen snapshot of one
-- project's report or one customer's billable report to someone outside Z8. Only the token's
-- SHA-256 digest is stored. Expiry and revocation null the snapshot; the row and its view log
-- stay. Views are kept for the audit-log lifetime (365 days) by the audit-log cleanup cron.
CREATE TABLE IF NOT EXISTS "report_share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"creator_employee_id" uuid,
	"kind" text NOT NULL,
	"project_id" uuid,
	"customer_id" uuid,
	"project_ids" uuid[] NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"figures" text NOT NULL,
	"include_employees" boolean DEFAULT false NOT NULL,
	"creator_locale" text NOT NULL,
	"token_digest" text NOT NULL,
	"token_hash_version" text NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	CONSTRAINT "report_share_link_kind_check" CHECK (kind IN ('project', 'customer')),
	CONSTRAINT "report_share_link_figures_check" CHECK (figures IN ('hours', 'revenue')),
	CONSTRAINT "report_share_link_range_check" CHECK ("report_share_link"."to_day" >= "report_share_link"."from_day"),
	CONSTRAINT "report_share_link_expiry_check" CHECK ("report_share_link"."expires_at" > "report_share_link"."created_at"),
	CONSTRAINT "report_share_link_revocation_check" CHECK ((revoked_at IS NULL AND revoke_reason IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND snapshot IS NULL AND revoke_reason IN ('manual', 'creator_lost_access', 'expired')))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_share_link_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"link_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_creator_employee_id_employee_id_fk" FOREIGN KEY ("creator_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link_view" ADD CONSTRAINT "report_share_link_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link_view" ADD CONSTRAINT "report_share_link_view_link_id_report_share_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."report_share_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reportShareLink_tokenDigest_idx" ON "report_share_link" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLink_org_createdAt_idx" ON "report_share_link" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLink_org_project_idx" ON "report_share_link" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLink_org_customer_idx" ON "report_share_link" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLink_live_idx" ON "report_share_link" USING btree ("expires_at") WHERE "report_share_link"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLinkView_link_viewedAt_idx" ON "report_share_link_view" USING btree ("link_id","viewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLinkView_org_idx" ON "report_share_link_view" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reportShareLinkView_viewedAt_idx" ON "report_share_link_view" USING btree ("viewed_at");
