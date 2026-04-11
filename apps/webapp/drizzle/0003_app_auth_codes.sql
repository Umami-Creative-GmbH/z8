CREATE TYPE "app_auth_type" AS ENUM ('mobile', 'desktop');
CREATE TYPE "app_auth_code_status" AS ENUM ('pending', 'used', 'expired');

CREATE TABLE "app_auth_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"app" "app_auth_type" NOT NULL,
	"code" text NOT NULL,
	"session_token" text NOT NULL,
	"status" "app_auth_code_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "app_auth_code"
	ADD CONSTRAINT "app_auth_code_user_id_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "appAuthCode_userId_idx" ON "app_auth_code" USING btree ("user_id");
CREATE INDEX "appAuthCode_app_status_idx" ON "app_auth_code" USING btree ("app", "status");
CREATE INDEX "appAuthCode_code_idx" ON "app_auth_code" USING btree ("code");
