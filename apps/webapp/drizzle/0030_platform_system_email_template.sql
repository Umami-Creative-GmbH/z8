CREATE TABLE "platform_system_email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"subject" text NOT NULL,
	"editor_document" jsonb NOT NULL,
	"html" text NOT NULL,
	"plain_text" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_system_email_template" ADD CONSTRAINT "platform_system_email_template_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_system_email_template" ADD CONSTRAINT "platform_system_email_template_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "platformSystemEmailTemplate_templateKey_idx" ON "platform_system_email_template" USING btree ("template_key");
