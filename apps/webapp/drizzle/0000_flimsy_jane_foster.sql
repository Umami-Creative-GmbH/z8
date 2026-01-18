CREATE TYPE "public"."absence_type" AS ENUM('home_office', 'sick', 'vacation', 'personal', 'unpaid', 'parental', 'bereavement', 'custom');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."day_period" AS ENUM('full_day', 'am', 'pm');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."holiday_category_type" AS ENUM('public_holiday', 'company_holiday', 'training_day', 'custom');--> statement-breakpoint
CREATE TYPE "public"."holiday_preset_assignment_type" AS ENUM('organization', 'team', 'employee');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('approval_request_submitted', 'approval_request_approved', 'approval_request_rejected', 'time_correction_submitted', 'time_correction_approved', 'time_correction_rejected', 'absence_request_submitted', 'absence_request_approved', 'absence_request_rejected', 'team_member_added', 'team_member_removed', 'password_changed', 'two_factor_enabled', 'two_factor_disabled', 'birthday_reminder', 'vacation_balance_alert', 'schedule_published', 'shift_assigned', 'shift_swap_requested', 'shift_swap_approved', 'shift_swap_rejected', 'shift_pickup_available', 'shift_pickup_approved', 'project_budget_warning_70', 'project_budget_warning_90', 'project_budget_warning_100', 'project_deadline_warning_14d', 'project_deadline_warning_7d', 'project_deadline_warning_1d', 'project_deadline_warning_0d', 'project_deadline_overdue', 'water_reminder');--> statement-breakpoint
CREATE TYPE "public"."project_assignment_type" AS ENUM('team', 'employee');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recurrence_type" AS ENUM('none', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'manager', 'employee');--> statement-breakpoint
CREATE TYPE "public"."schedule_cycle" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('simple', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."shift_request_type" AS ENUM('swap', 'assignment', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."surcharge_rule_type" AS ENUM('day_of_week', 'time_window', 'date_based');--> statement-breakpoint
CREATE TYPE "public"."time_entry_type" AS ENUM('clock_in', 'clock_out', 'correction');--> statement-breakpoint
CREATE TYPE "public"."time_regulation_violation_type" AS ENUM('max_daily', 'max_weekly', 'max_uninterrupted', 'break_required');--> statement-breakpoint
CREATE TYPE "public"."water_intake_source" AS ENUM('reminder_action', 'manual', 'widget');--> statement-breakpoint
CREATE TYPE "public"."working_days_preset" AS ENUM('weekdays', 'weekends', 'all_days', 'custom');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL,
	"can_create_organizations" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"country" text,
	"region" text,
	"shifts_enabled" boolean DEFAULT false,
	"projects_enabled" boolean DEFAULT false,
	"surcharges_enabled" boolean DEFAULT false,
	"timezone" text DEFAULT 'UTC',
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"two_factor_enabled" boolean DEFAULT false,
	"can_create_organizations" boolean DEFAULT false,
	"invited_via" text,
	"onboarding_complete" boolean DEFAULT false,
	"onboarding_step" text,
	"onboarding_started_at" timestamp,
	"onboarding_completed_at" timestamp,
	"timezone" text DEFAULT 'UTC',
	"water_reminder_enabled" boolean DEFAULT false,
	"water_reminder_preset" text DEFAULT 'moderate',
	"water_reminder_interval_minutes" integer DEFAULT 45,
	"water_reminder_daily_goal" integer DEFAULT 8,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "absence_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"type" "absence_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_work_time" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"counts_against_vacation" boolean DEFAULT true NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "absence_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"start_period" "day_period" DEFAULT 'full_day' NOT NULL,
	"end_date" date NOT NULL,
	"end_period" "day_period" DEFAULT 'full_day' NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"approved_by" uuid,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"notes" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"performed_by" text NOT NULL,
	"employee_id" uuid,
	"changes" text,
	"metadata" text,
	"ip_address" text,
	"user_agent" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"logo_url" text,
	"background_image_url" text,
	"app_name" text,
	"primary_color" text,
	"accent_color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "organization_branding_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_domain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"verification_token" text,
	"verification_token_expires_at" timestamp,
	"auth_config" text DEFAULT '{"emailPasswordEnabled":true,"socialProvidersEnabled":[],"ssoEnabled":false,"passkeyEnabled":true}',
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "organization_domain_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "data_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"categories" text[] NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"s3_key" text,
	"file_size_bytes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "export_storage_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"bucket" text NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_access_key" text NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"endpoint" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "export_storage_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"recurrence_type" "recurrence_type" DEFAULT 'none' NOT NULL,
	"recurrence_rule" text,
	"recurrence_end_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "holiday_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holiday_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"type" "holiday_category_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"blocks_time_entry" boolean DEFAULT true NOT NULL,
	"exclude_from_calculations" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"country_code" text,
	"state_code" text,
	"region_code" text,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "holiday_preset_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp,
	"effective_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_preset_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"holiday_type" text,
	"is_floating" boolean DEFAULT false NOT NULL,
	"floating_rule" text,
	"category_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" uuid,
	"manager_id" uuid,
	"first_name" text,
	"last_name" text,
	"gender" "gender",
	"birthday" timestamp,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"employee_number" text,
	"position" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"city" text,
	"postal_code" text,
	"country" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "location_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_subarea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "subarea_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subarea_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" uuid,
	"can_create_teams" boolean DEFAULT false NOT NULL,
	"can_manage_team_members" boolean DEFAULT false NOT NULL,
	"can_manage_team_settings" boolean DEFAULT false NOT NULL,
	"can_approve_team_requests" boolean DEFAULT false NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedule_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp,
	"effective_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedule_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schedule_cycle" "schedule_cycle" DEFAULT 'weekly' NOT NULL,
	"schedule_type" "schedule_type" DEFAULT 'simple' NOT NULL,
	"working_days_preset" "working_days_preset" DEFAULT 'weekdays' NOT NULL,
	"hours_per_cycle" numeric(6, 2),
	"home_office_days_per_cycle" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "work_schedule_template_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"hours_per_day" numeric(4, 2) NOT NULL,
	"is_work_day" boolean DEFAULT true NOT NULL,
	"cycle_week" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid,
	"template_id" uuid,
	"date" timestamp NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"status" "shift_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"notes" text,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"type" "shift_request_type" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requester_id" uuid NOT NULL,
	"target_employee_id" uuid,
	"reason" text,
	"reason_category" text,
	"notes" text,
	"approver_id" uuid,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"icon" text,
	"color" text,
	"budget_hours" numeric(8, 2),
	"deadline" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "project_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "project_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_manager" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_notification_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"budget_thresholds_notified" integer[] DEFAULT '{}',
	"deadline_thresholds_notified" integer[] DEFAULT '{}',
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" time_entry_type NOT NULL,
	"timestamp" timestamp NOT NULL,
	"previous_entry_id" uuid,
	"hash" text NOT NULL,
	"previous_hash" text,
	"replaces_entry_id" uuid,
	"is_superseded" boolean DEFAULT false NOT NULL,
	"superseded_by_id" uuid,
	"notes" text,
	"location" text,
	"ip_address" text,
	"device_info" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"clock_in_id" uuid NOT NULL,
	"clock_out_id" uuid,
	"project_id" uuid,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"was_auto_adjusted" boolean DEFAULT false NOT NULL,
	"auto_adjustment_reason" text,
	"auto_adjusted_at" timestamp with time zone,
	"original_end_time" timestamp with time zone,
	"original_duration_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_vacation_allowance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"custom_annual_days" numeric,
	"custom_carryover_days" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"days" numeric(5, 2) NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_allowance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"valid_until" date,
	"is_company_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"default_annual_days" numeric NOT NULL,
	"accrual_type" text NOT NULL,
	"accrual_start_month" integer DEFAULT 1,
	"allow_carryover" boolean DEFAULT false NOT NULL,
	"max_carryover_days" numeric,
	"carryover_expiry_months" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_policy_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp,
	"effective_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_regulation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"max_daily_minutes" integer,
	"max_weekly_minutes" integer,
	"max_uninterrupted_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "time_regulation_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regulation_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp,
	"effective_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_regulation_break_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"break_rule_id" uuid NOT NULL,
	"split_count" integer,
	"minimum_split_minutes" integer,
	"minimum_longest_split_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_regulation_break_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regulation_id" uuid NOT NULL,
	"working_minutes_threshold" integer NOT NULL,
	"required_break_minutes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_regulation_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"country_code" text,
	"max_daily_minutes" integer,
	"max_weekly_minutes" integer,
	"max_uninterrupted_minutes" integer,
	"break_rules_json" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "time_regulation_preset_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "time_regulation_violation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"regulation_id" uuid,
	"work_period_id" uuid,
	"violation_date" timestamp NOT NULL,
	"violation_type" time_regulation_violation_type NOT NULL,
	"details" text,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp,
	"acknowledged_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surcharge_calculation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"work_period_id" uuid NOT NULL,
	"surcharge_rule_id" uuid,
	"surcharge_model_id" uuid,
	"calculation_date" timestamp NOT NULL,
	"base_minutes" integer NOT NULL,
	"qualifying_minutes" integer NOT NULL,
	"surcharge_minutes" integer NOT NULL,
	"applied_percentage" numeric(5, 4) NOT NULL,
	"calculation_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surcharge_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "surcharge_model_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp,
	"effective_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surcharge_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rule_type" "surcharge_rule_type" NOT NULL,
	"percentage" numeric(5, 4) NOT NULL,
	"day_of_week" "day_of_week",
	"window_start_time" text,
	"window_end_time" text,
	"specific_date" timestamp,
	"date_range_start" timestamp,
	"date_range_end" timestamp,
	"priority" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"action_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"notification_type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"device_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hydration_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_goal_met_date" date,
	"total_intake_all_time" integer DEFAULT 0 NOT NULL,
	"snoozed_until" timestamp,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "hydration_stats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "water_intake_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"logged_at" timestamp DEFAULT now() NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"source" "water_intake_source" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dashboard_widget_order" text,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"onboarding_step" text,
	"onboarding_started_at" timestamp,
	"onboarding_completed_at" timestamp,
	"water_reminder_enabled" boolean DEFAULT false NOT NULL,
	"water_reminder_preset" text DEFAULT 'moderate' NOT NULL,
	"water_reminder_interval_minutes" integer DEFAULT 45 NOT NULL,
	"water_reminder_daily_goal" integer DEFAULT 8 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_category" ADD CONSTRAINT "absence_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_category_id_absence_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."absence_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_approved_by_employee_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_employee_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_requested_by_id_employee_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_storage_config" ADD CONSTRAINT "export_storage_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_storage_config" ADD CONSTRAINT "export_storage_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_category_id_holiday_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_holiday_id_holiday_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holiday"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category" ADD CONSTRAINT "holiday_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset" ADD CONSTRAINT "holiday_preset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset" ADD CONSTRAINT "holiday_preset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset" ADD CONSTRAINT "holiday_preset_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_preset_id_holiday_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."holiday_preset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_holiday" ADD CONSTRAINT "holiday_preset_holiday_preset_id_holiday_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."holiday_preset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_holiday" ADD CONSTRAINT "holiday_preset_holiday_category_id_holiday_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_managers" ADD CONSTRAINT "employee_managers_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_managers" ADD CONSTRAINT "employee_managers_manager_id_employee_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_managers" ADD CONSTRAINT "employee_managers_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_employee" ADD CONSTRAINT "location_employee_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_employee" ADD CONSTRAINT "location_employee_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_employee" ADD CONSTRAINT "location_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_subarea" ADD CONSTRAINT "location_subarea_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_subarea" ADD CONSTRAINT "location_subarea_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_subarea" ADD CONSTRAINT "location_subarea_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subarea_employee" ADD CONSTRAINT "subarea_employee_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subarea_employee" ADD CONSTRAINT "subarea_employee_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subarea_employee" ADD CONSTRAINT "subarea_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_permissions" ADD CONSTRAINT "team_permissions_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_permissions" ADD CONSTRAINT "team_permissions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_permissions" ADD CONSTRAINT "team_permissions_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_permissions" ADD CONSTRAINT "team_permissions_granted_by_employee_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_assignment" ADD CONSTRAINT "work_schedule_assignment_template_id_work_schedule_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_schedule_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_assignment" ADD CONSTRAINT "work_schedule_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_assignment" ADD CONSTRAINT "work_schedule_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_assignment" ADD CONSTRAINT "work_schedule_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_assignment" ADD CONSTRAINT "work_schedule_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_template" ADD CONSTRAINT "work_schedule_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_template" ADD CONSTRAINT "work_schedule_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_template" ADD CONSTRAINT "work_schedule_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_template_days" ADD CONSTRAINT "work_schedule_template_days_template_id_work_schedule_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_schedule_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_template_id_shift_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_requester_id_employee_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_target_employee_id_employee_id_fk" FOREIGN KEY ("target_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template" ADD CONSTRAINT "shift_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template" ADD CONSTRAINT "shift_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notification_state" ADD CONSTRAINT "project_notification_state_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_clock_in_id_time_entry_id_fk" FOREIGN KEY ("clock_in_id") REFERENCES "public"."time_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_clock_out_id_time_entry_id_fk" FOREIGN KEY ("clock_out_id") REFERENCES "public"."time_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_vacation_allowance" ADD CONSTRAINT "employee_vacation_allowance_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_adjustment" ADD CONSTRAINT "vacation_adjustment_adjusted_by_employee_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ADD CONSTRAINT "vacation_allowance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ADD CONSTRAINT "vacation_allowance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_policy_id_vacation_allowance_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."vacation_allowance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation" ADD CONSTRAINT "time_regulation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation" ADD CONSTRAINT "time_regulation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation" ADD CONSTRAINT "time_regulation_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_assignment" ADD CONSTRAINT "time_regulation_assignment_regulation_id_time_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."time_regulation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_assignment" ADD CONSTRAINT "time_regulation_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_assignment" ADD CONSTRAINT "time_regulation_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_assignment" ADD CONSTRAINT "time_regulation_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_assignment" ADD CONSTRAINT "time_regulation_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_break_option" ADD CONSTRAINT "time_regulation_break_option_break_rule_id_time_regulation_break_rule_id_fk" FOREIGN KEY ("break_rule_id") REFERENCES "public"."time_regulation_break_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_break_rule" ADD CONSTRAINT "time_regulation_break_rule_regulation_id_time_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."time_regulation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_violation" ADD CONSTRAINT "time_regulation_violation_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_violation" ADD CONSTRAINT "time_regulation_violation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_violation" ADD CONSTRAINT "time_regulation_violation_regulation_id_time_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."time_regulation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_violation" ADD CONSTRAINT "time_regulation_violation_work_period_id_work_period_id_fk" FOREIGN KEY ("work_period_id") REFERENCES "public"."work_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_regulation_violation" ADD CONSTRAINT "time_regulation_violation_acknowledged_by_employee_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_calculation" ADD CONSTRAINT "surcharge_calculation_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_calculation" ADD CONSTRAINT "surcharge_calculation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_calculation" ADD CONSTRAINT "surcharge_calculation_work_period_id_work_period_id_fk" FOREIGN KEY ("work_period_id") REFERENCES "public"."work_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_calculation" ADD CONSTRAINT "surcharge_calculation_surcharge_rule_id_surcharge_rule_id_fk" FOREIGN KEY ("surcharge_rule_id") REFERENCES "public"."surcharge_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_calculation" ADD CONSTRAINT "surcharge_calculation_surcharge_model_id_surcharge_model_id_fk" FOREIGN KEY ("surcharge_model_id") REFERENCES "public"."surcharge_model"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model" ADD CONSTRAINT "surcharge_model_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model" ADD CONSTRAINT "surcharge_model_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model" ADD CONSTRAINT "surcharge_model_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model_assignment" ADD CONSTRAINT "surcharge_model_assignment_model_id_surcharge_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."surcharge_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model_assignment" ADD CONSTRAINT "surcharge_model_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model_assignment" ADD CONSTRAINT "surcharge_model_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model_assignment" ADD CONSTRAINT "surcharge_model_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_model_assignment" ADD CONSTRAINT "surcharge_model_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_rule" ADD CONSTRAINT "surcharge_rule_model_id_surcharge_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."surcharge_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharge_rule" ADD CONSTRAINT "surcharge_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hydration_stats" ADD CONSTRAINT "hydration_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_intake_log" ADD CONSTRAINT "water_intake_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "absenceCategory_organizationId_idx" ON "absence_category" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "absenceEntry_employeeId_idx" ON "absence_entry" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "absenceEntry_startDate_idx" ON "absence_entry" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "absenceEntry_status_idx" ON "absence_entry" USING btree ("status");--> statement-breakpoint
CREATE INDEX "absenceEntry_employeeId_status_idx" ON "absence_entry" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "approvalRequest_entityType_entityId_idx" ON "approval_request" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approvalRequest_approverId_idx" ON "approval_request" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "approvalRequest_status_idx" ON "approval_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auditLog_entityType_entityId_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "auditLog_performedBy_idx" ON "audit_log" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "auditLog_timestamp_idx" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "organizationBranding_organizationId_idx" ON "organization_branding" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationDomain_organizationId_idx" ON "organization_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationDomain_domain_idx" ON "organization_domain" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organizationDomain_domainVerified_idx" ON "organization_domain" USING btree ("domain_verified");--> statement-breakpoint
CREATE UNIQUE INDEX "organizationDomain_org_single_idx" ON "organization_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dataExport_organizationId_idx" ON "data_export" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dataExport_requestedById_idx" ON "data_export" USING btree ("requested_by_id");--> statement-breakpoint
CREATE INDEX "dataExport_status_idx" ON "data_export" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dataExport_createdAt_idx" ON "data_export" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "exportStorageConfig_organizationId_idx" ON "export_storage_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "holiday_organizationId_idx" ON "holiday" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "holiday_startDate_idx" ON "holiday" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "holiday_categoryId_idx" ON "holiday" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "holiday_orgId_isActive_recurrenceType_idx" ON "holiday" USING btree ("organization_id","is_active","recurrence_type");--> statement-breakpoint
CREATE INDEX "holidayAssignment_holidayId_idx" ON "holiday_assignment" USING btree ("holiday_id");--> statement-breakpoint
CREATE INDEX "holidayAssignment_organizationId_idx" ON "holiday_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "holidayAssignment_teamId_idx" ON "holiday_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "holidayAssignment_employeeId_idx" ON "holiday_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayAssignment_holiday_org_idx" ON "holiday_assignment" USING btree ("holiday_id","organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayAssignment_holiday_team_idx" ON "holiday_assignment" USING btree ("holiday_id","team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayAssignment_holiday_employee_idx" ON "holiday_assignment" USING btree ("holiday_id","employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "holidayCategory_organizationId_idx" ON "holiday_category" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "holidayPreset_organizationId_idx" ON "holiday_preset" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPreset_org_location_idx" ON "holiday_preset" USING btree ("organization_id","country_code","state_code","region_code");--> statement-breakpoint
CREATE INDEX "holidayPresetAssignment_presetId_idx" ON "holiday_preset_assignment" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "holidayPresetAssignment_organizationId_idx" ON "holiday_preset_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "holidayPresetAssignment_teamId_idx" ON "holiday_preset_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "holidayPresetAssignment_employeeId_idx" ON "holiday_preset_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPresetAssignment_org_default_idx" ON "holiday_preset_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPresetAssignment_team_idx" ON "holiday_preset_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPresetAssignment_employee_idx" ON "holiday_preset_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "holidayPresetHoliday_presetId_idx" ON "holiday_preset_holiday" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "holidayPresetHoliday_categoryId_idx" ON "holiday_preset_holiday" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPresetHoliday_preset_name_idx" ON "holiday_preset_holiday" USING btree ("preset_id","name");--> statement-breakpoint
CREATE INDEX "employee_userId_idx" ON "employee" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_organizationId_idx" ON "employee" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employee_teamId_idx" ON "employee" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "employee_managerId_idx" ON "employee" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employee_userId_isActive_idx" ON "employee" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "employeeManagers_employeeId_idx" ON "employee_managers" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeManagers_managerId_idx" ON "employee_managers" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employeeManagers_unique_idx" ON "employee_managers" USING btree ("employee_id","manager_id");--> statement-breakpoint
CREATE INDEX "employeeManagers_managerId_isPrimary_idx" ON "employee_managers" USING btree ("manager_id","is_primary");--> statement-breakpoint
CREATE INDEX "location_organizationId_idx" ON "location" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "location_isActive_idx" ON "location" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "location_org_name_idx" ON "location" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "locationEmployee_locationId_idx" ON "location_employee" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "locationEmployee_employeeId_idx" ON "location_employee" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locationEmployee_unique_idx" ON "location_employee" USING btree ("location_id","employee_id");--> statement-breakpoint
CREATE INDEX "locationSubarea_locationId_idx" ON "location_subarea" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "locationSubarea_isActive_idx" ON "location_subarea" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "locationSubarea_location_name_idx" ON "location_subarea" USING btree ("location_id","name");--> statement-breakpoint
CREATE INDEX "subareaEmployee_subareaId_idx" ON "subarea_employee" USING btree ("subarea_id");--> statement-breakpoint
CREATE INDEX "subareaEmployee_employeeId_idx" ON "subarea_employee" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subareaEmployee_unique_idx" ON "subarea_employee" USING btree ("subarea_id","employee_id");--> statement-breakpoint
CREATE INDEX "team_organizationId_idx" ON "team" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamPermissions_employeeId_idx" ON "team_permissions" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "teamPermissions_organizationId_idx" ON "team_permissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamPermissions_teamId_idx" ON "team_permissions" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "teamPermissions_unique_idx" ON "team_permissions" USING btree ("employee_id","organization_id");--> statement-breakpoint
CREATE INDEX "workScheduleAssignment_templateId_idx" ON "work_schedule_assignment" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "workScheduleAssignment_organizationId_idx" ON "work_schedule_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workScheduleAssignment_teamId_idx" ON "work_schedule_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "workScheduleAssignment_employeeId_idx" ON "work_schedule_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workScheduleAssignment_org_default_idx" ON "work_schedule_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workScheduleAssignment_team_idx" ON "work_schedule_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workScheduleAssignment_employee_idx" ON "work_schedule_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "workScheduleTemplate_organizationId_idx" ON "work_schedule_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workScheduleTemplate_isActive_idx" ON "work_schedule_template" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "workScheduleTemplate_org_name_idx" ON "work_schedule_template" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "workScheduleTemplateDays_templateId_idx" ON "work_schedule_template_days" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workScheduleTemplateDays_unique_idx" ON "work_schedule_template_days" USING btree ("template_id","day_of_week","cycle_week");--> statement-breakpoint
CREATE INDEX "shift_organizationId_idx" ON "shift" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shift_employeeId_idx" ON "shift" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "shift_templateId_idx" ON "shift" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "shift_date_idx" ON "shift" USING btree ("date");--> statement-breakpoint
CREATE INDEX "shift_status_idx" ON "shift" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shift_org_date_status_idx" ON "shift" USING btree ("organization_id","date","status");--> statement-breakpoint
CREATE INDEX "shift_org_employee_date_idx" ON "shift" USING btree ("organization_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "shiftRequest_shiftId_idx" ON "shift_request" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_requesterId_idx" ON "shift_request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_targetEmployeeId_idx" ON "shift_request" USING btree ("target_employee_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_approverId_idx" ON "shift_request" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_status_idx" ON "shift_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shiftRequest_type_status_idx" ON "shift_request" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "shiftTemplate_organizationId_idx" ON "shift_template" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shiftTemplate_org_name_idx" ON "shift_template" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "project_organizationId_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_status_idx" ON "project" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_deadline_idx" ON "project" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "project_isActive_idx" ON "project" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_name_idx" ON "project" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "projectAssignment_projectId_idx" ON "project_assignment" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projectAssignment_organizationId_idx" ON "project_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projectAssignment_teamId_idx" ON "project_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projectAssignment_employeeId_idx" ON "project_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectAssignment_team_unique_idx" ON "project_assignment" USING btree ("project_id","team_id") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projectAssignment_employee_unique_idx" ON "project_assignment" USING btree ("project_id","employee_id") WHERE employee_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "projectManager_projectId_idx" ON "project_manager" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projectManager_employeeId_idx" ON "project_manager" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectManager_unique_idx" ON "project_manager" USING btree ("project_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectNotificationState_project_unique_idx" ON "project_notification_state" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "timeEntry_employeeId_idx" ON "time_entry" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "timeEntry_timestamp_idx" ON "time_entry" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "timeEntry_previousEntryId_idx" ON "time_entry" USING btree ("previous_entry_id");--> statement-breakpoint
CREATE INDEX "timeEntry_replacesEntryId_idx" ON "time_entry" USING btree ("replaces_entry_id");--> statement-breakpoint
CREATE INDEX "timeEntry_employeeId_isSuperseded_timestamp_idx" ON "time_entry" USING btree ("employee_id","is_superseded","timestamp");--> statement-breakpoint
CREATE INDEX "workPeriod_employeeId_idx" ON "work_period" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "workPeriod_startTime_idx" ON "work_period" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "workPeriod_projectId_idx" ON "work_period" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "employeeVacationAllowance_employeeId_idx" ON "employee_vacation_allowance" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeVacationAllowance_employeeId_year_idx" ON "employee_vacation_allowance" USING btree ("employee_id","year");--> statement-breakpoint
CREATE INDEX "vacationAdjustment_employee_year_idx" ON "vacation_adjustment" USING btree ("employee_id","year");--> statement-breakpoint
CREATE INDEX "vacationAllowance_organizationId_idx" ON "vacation_allowance" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vacationAllowance_startDate_idx" ON "vacation_allowance" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vacationAllowance_org_name_active_idx" ON "vacation_allowance" USING btree ("organization_id","name") WHERE is_active = true AND valid_until IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vacationAllowance_org_company_default_idx" ON "vacation_allowance" USING btree ("organization_id") WHERE is_company_default = true AND is_active = true AND valid_until IS NULL;--> statement-breakpoint
CREATE INDEX "vacationPolicyAssignment_policyId_idx" ON "vacation_policy_assignment" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "vacationPolicyAssignment_organizationId_idx" ON "vacation_policy_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vacationPolicyAssignment_teamId_idx" ON "vacation_policy_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "vacationPolicyAssignment_employeeId_idx" ON "vacation_policy_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacationPolicyAssignment_org_default_idx" ON "vacation_policy_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "vacationPolicyAssignment_team_idx" ON "vacation_policy_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "vacationPolicyAssignment_employee_idx" ON "vacation_policy_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "timeRegulation_organizationId_idx" ON "time_regulation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRegulation_isActive_idx" ON "time_regulation" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "timeRegulation_org_name_idx" ON "time_regulation" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "timeRegulationAssignment_regulationId_idx" ON "time_regulation_assignment" USING btree ("regulation_id");--> statement-breakpoint
CREATE INDEX "timeRegulationAssignment_organizationId_idx" ON "time_regulation_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRegulationAssignment_teamId_idx" ON "time_regulation_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "timeRegulationAssignment_employeeId_idx" ON "time_regulation_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeRegulationAssignment_org_default_idx" ON "time_regulation_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "timeRegulationAssignment_team_idx" ON "time_regulation_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "timeRegulationAssignment_employee_idx" ON "time_regulation_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "timeRegulationBreakOption_breakRuleId_idx" ON "time_regulation_break_option" USING btree ("break_rule_id");--> statement-breakpoint
CREATE INDEX "timeRegulationBreakRule_regulationId_idx" ON "time_regulation_break_rule" USING btree ("regulation_id");--> statement-breakpoint
CREATE INDEX "timeRegulationBreakRule_sortOrder_idx" ON "time_regulation_break_rule" USING btree ("regulation_id","sort_order");--> statement-breakpoint
CREATE INDEX "timeRegulationPreset_countryCode_idx" ON "time_regulation_preset" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "timeRegulationPreset_isActive_idx" ON "time_regulation_preset" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_employeeId_idx" ON "time_regulation_violation" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_organizationId_idx" ON "time_regulation_violation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_regulationId_idx" ON "time_regulation_violation" USING btree ("regulation_id");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_violationDate_idx" ON "time_regulation_violation" USING btree ("violation_date");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_violationType_idx" ON "time_regulation_violation" USING btree ("violation_type");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_org_date_idx" ON "time_regulation_violation" USING btree ("organization_id","violation_date");--> statement-breakpoint
CREATE INDEX "timeRegulationViolation_emp_date_idx" ON "time_regulation_violation" USING btree ("employee_id","violation_date");--> statement-breakpoint
CREATE INDEX "surchargeCalculation_employeeId_idx" ON "surcharge_calculation" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "surchargeCalculation_organizationId_idx" ON "surcharge_calculation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "surchargeCalculation_workPeriodId_idx" ON "surcharge_calculation" USING btree ("work_period_id");--> statement-breakpoint
CREATE INDEX "surchargeCalculation_calculationDate_idx" ON "surcharge_calculation" USING btree ("calculation_date");--> statement-breakpoint
CREATE INDEX "surchargeCalculation_emp_date_idx" ON "surcharge_calculation" USING btree ("employee_id","calculation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "surchargeCalculation_workPeriod_idx" ON "surcharge_calculation" USING btree ("work_period_id");--> statement-breakpoint
CREATE INDEX "surchargeModel_organizationId_idx" ON "surcharge_model" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "surchargeModel_isActive_idx" ON "surcharge_model" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "surchargeModel_org_name_idx" ON "surcharge_model" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "surchargeModelAssignment_modelId_idx" ON "surcharge_model_assignment" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "surchargeModelAssignment_organizationId_idx" ON "surcharge_model_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "surchargeModelAssignment_teamId_idx" ON "surcharge_model_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "surchargeModelAssignment_employeeId_idx" ON "surcharge_model_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "surchargeModelAssignment_org_default_idx" ON "surcharge_model_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "surchargeModelAssignment_team_idx" ON "surcharge_model_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "surchargeModelAssignment_employee_idx" ON "surcharge_model_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "surchargeRule_modelId_idx" ON "surcharge_rule" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "surchargeRule_ruleType_idx" ON "surcharge_rule" USING btree ("rule_type");--> statement-breakpoint
CREATE INDEX "surchargeRule_priority_idx" ON "surcharge_rule" USING btree ("model_id","priority");--> statement-breakpoint
CREATE INDEX "surchargeRule_isActive_idx" ON "surcharge_rule" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "notification_userId_idx" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_organizationId_idx" ON "notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_isRead_idx" ON "notification" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "notification_createdAt_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_type_idx" ON "notification" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notification_userId_orgId_isRead_idx" ON "notification" USING btree ("user_id","organization_id","is_read");--> statement-breakpoint
CREATE INDEX "notification_userId_orgId_createdAt_idx" ON "notification" USING btree ("user_id","organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notificationPreference_userId_idx" ON "notification_preference" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notificationPreference_unique_idx" ON "notification_preference" USING btree ("user_id","notification_type","channel");--> statement-breakpoint
CREATE INDEX "pushSubscription_userId_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pushSubscription_endpoint_idx" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "pushSubscription_isActive_idx" ON "push_subscription" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "pushSubscription_userId_isActive_idx" ON "push_subscription" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "hydration_stats_userId_idx" ON "hydration_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "water_intake_log_userId_idx" ON "water_intake_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "water_intake_log_loggedAt_idx" ON "water_intake_log" USING btree ("logged_at");--> statement-breakpoint
CREATE INDEX "userSettings_userId_idx" ON "user_settings" USING btree ("user_id");