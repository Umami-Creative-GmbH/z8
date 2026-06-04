ALTER TABLE "organization_email_config"
	ADD COLUMN IF NOT EXISTS "smtp_ip_mode" text DEFAULT 'auto';
