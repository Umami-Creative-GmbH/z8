-- #843: native push device tokens (Firebase Cloud Messaging) of the store app.
-- User-scoped like push_subscription; one row per device token.
-- session_id binds the token to the session that registered it: pushes go only
-- to tokens whose session still exists and has not expired, so a server-side
-- sign-out stops them. Deleting the session clears the binding.
CREATE TABLE IF NOT EXISTS "push_device_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_device_token_platform_check" CHECK ("push_device_token"."platform" IN ('ios', 'android'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_device_token" ADD CONSTRAINT "push_device_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_device_token" ADD CONSTRAINT "push_device_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pushDeviceToken_token_idx" ON "push_device_token" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pushDeviceToken_userId_isActive_idx" ON "push_device_token" USING btree ("user_id","is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pushDeviceToken_sessionId_idx" ON "push_device_token" USING btree ("session_id");
