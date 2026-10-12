-- Public API (#763): the key request log. One row per request made with an
-- identified API key, kept for 90 days. Key usage never goes to audit_log.
CREATE TABLE IF NOT EXISTS "public_api_request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"status" integer NOT NULL,
	"row_count" integer,
	"ip_address" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_api_request_log" ADD CONSTRAINT "public_api_request_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publicApiRequestLog_org_key_requestedAt_idx" ON "public_api_request_log" USING btree ("organization_id","api_key_id","requested_at");--> statement-breakpoint
CREATE INDEX "publicApiRequestLog_requestedAt_idx" ON "public_api_request_log" USING btree ("requested_at");
