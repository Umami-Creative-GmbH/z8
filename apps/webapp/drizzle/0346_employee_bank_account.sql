-- #2069 (spec #2068): an employee's bank account as a date-effective history per
-- organization, and the mandatory "personal details changed" notification that
-- tells the employee about every applied change (IBAN last four only).
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personal_details_changed';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"account_holder" text,
	"iban" text,
	"bic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "employeeBankAccount_org_employee_valid_from_unique" UNIQUE("organization_id","employee_id","valid_from"),
	CONSTRAINT "employeeBankAccount_value_check" CHECK (("account_holder" IS NULL AND "iban" IS NULL AND "bic" IS NULL)
				OR ("account_holder" IS NOT NULL AND "iban" IS NOT NULL)),
	CONSTRAINT "employeeBankAccount_account_holder_check" CHECK ("account_holder" IS NULL OR char_length("account_holder") BETWEEN 1 AND 70),
	CONSTRAINT "employeeBankAccount_iban_check" CHECK ("iban" IS NULL OR "iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
	CONSTRAINT "employeeBankAccount_bic_check" CHECK ("bic" IS NULL OR "bic" ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$')
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_bank_account" ADD CONSTRAINT "employee_bank_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_bank_account" ADD CONSTRAINT "employee_bank_account_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_bank_account" ADD CONSTRAINT "employee_bank_account_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_bank_account" ADD CONSTRAINT "employeeBankAccount_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
