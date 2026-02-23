CREATE TYPE "public"."access_violation_action" AS ENUM('blocked', 'challenged', 'logged');--> statement-breakpoint
CREATE TYPE "public"."access_violation_type" AS ENUM('ip_blocked', 'ip_not_whitelisted', 'country_blocked', 'country_not_allowed', 'untrusted_device', 'mfa_required', 'passkey_required', 'session_expired', 'session_idle_timeout', 'concurrent_session_limit');--> statement-breakpoint
CREATE TYPE "public"."device_trust_source" AS ENUM('passkey', 'admin_registered', 'remember_device', 'mdm');--> statement-breakpoint
CREATE TYPE "public"."audit_pack_status" AS ENUM('requested', 'collecting', 'lineage_expanding', 'assembling', 'hardening', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_export_status" AS ENUM('pending', 'building_manifest', 'signing', 'timestamping', 'uploading', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."verification_check" AS ENUM('file_hashes', 'merkle_root', 'signature', 'timestamp', 'worm_lock');--> statement-breakpoint
CREATE TYPE "public"."worm_retention_mode" AS ENUM('governance', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'microsoft365', 'icloud', 'caldav');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_status" AS ENUM('pending', 'synced', 'error', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."ics_feed_type" AS ENUM('user', 'team');--> statement-breakpoint
CREATE TYPE "public"."absence_type" AS ENUM('home_office', 'sick', 'vacation', 'personal', 'unpaid', 'parental', 'bereavement', 'custom');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."compliance_exception_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'used');--> statement-breakpoint
CREATE TYPE "public"."compliance_exception_type" AS ENUM('rest_period', 'overtime_daily', 'overtime_weekly', 'overtime_monthly');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('fixed', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."day_period" AS ENUM('full_day', 'am', 'pm');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."holiday_category_type" AS ENUM('public_holiday', 'company_holiday', 'training_day', 'custom');--> statement-breakpoint
CREATE TYPE "public"."holiday_preset_assignment_type" AS ENUM('organization', 'team', 'employee');--> statement-breakpoint
CREATE TYPE "public"."invite_code_status" AS ENUM('active', 'paused', 'expired', 'archived');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'email', 'teams', 'telegram', 'discord', 'slack');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('approval_request_submitted', 'approval_request_approved', 'approval_request_rejected', 'time_correction_submitted', 'time_correction_approved', 'time_correction_rejected', 'absence_request_submitted', 'absence_request_approved', 'absence_request_rejected', 'team_member_added', 'team_member_removed', 'password_changed', 'two_factor_enabled', 'two_factor_disabled', 'birthday_reminder', 'vacation_balance_alert', 'schedule_published', 'shift_assigned', 'shift_swap_requested', 'shift_swap_approved', 'shift_swap_rejected', 'shift_pickup_available', 'shift_pickup_approved', 'project_budget_warning_70', 'project_budget_warning_90', 'project_budget_warning_100', 'project_deadline_warning_14d', 'project_deadline_warning_7d', 'project_deadline_warning_1d', 'project_deadline_warning_0d', 'project_deadline_overdue', 'water_reminder', 'rest_period_warning', 'rest_period_violation', 'overtime_warning', 'overtime_violation', 'compliance_exception_requested', 'compliance_exception_approved', 'compliance_exception_rejected', 'compliance_exception_expired');--> statement-breakpoint
CREATE TYPE "public"."payroll_export_format_type" AS ENUM('datev_lohn', 'personio', 'sage', 'lexware', 'custom');--> statement-breakpoint
CREATE TYPE "public"."payroll_export_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."presence_enforcement" AS ENUM('block', 'warn', 'none');--> statement-breakpoint
CREATE TYPE "public"."presence_evaluation_period" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."presence_mode" AS ENUM('minimum_count', 'fixed_days');--> statement-breakpoint
CREATE TYPE "public"."project_assignment_type" AS ENUM('team', 'employee');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recurrence_type" AS ENUM('none', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."rest_period_enforcement" AS ENUM('block', 'warn', 'none');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'manager', 'employee');--> statement-breakpoint
CREATE TYPE "public"."schedule_cycle" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('simple', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."scheduled_export_date_range_strategy" AS ENUM('previous_day', 'previous_week', 'previous_month', 'previous_quarter', 'custom_offset');--> statement-breakpoint
CREATE TYPE "public"."scheduled_export_delivery_method" AS ENUM('s3_only', 'email_only', 's3_and_email');--> statement-breakpoint
CREATE TYPE "public"."scheduled_export_execution_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scheduled_export_report_type" AS ENUM('payroll_export', 'data_export', 'audit_report');--> statement-breakpoint
CREATE TYPE "public"."scheduled_export_schedule_type" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'cron');--> statement-breakpoint
CREATE TYPE "public"."shift_recurrence_type" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."shift_request_type" AS ENUM('swap', 'assignment', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."skill_category" AS ENUM('safety', 'equipment', 'certification', 'training', 'language', 'custom');--> statement-breakpoint
CREATE TYPE "public"."surcharge_rule_type" AS ENUM('day_of_week', 'time_window', 'date_based');--> statement-breakpoint
CREATE TYPE "public"."time_entry_type" AS ENUM('clock_in', 'clock_out', 'correction');--> statement-breakpoint
CREATE TYPE "public"."time_regulation_violation_type" AS ENUM('max_daily', 'max_weekly', 'max_uninterrupted', 'break_required', 'rest_period', 'overtime_daily', 'overtime_weekly', 'overtime_monthly');--> statement-breakpoint
CREATE TYPE "public"."water_intake_source" AS ENUM('reminder_action', 'manual', 'widget');--> statement-breakpoint
CREATE TYPE "public"."work_location_type" AS ENUM('office', 'home', 'field', 'other');--> statement-breakpoint
CREATE TYPE "public"."working_days_preset" AS ENUM('weekdays', 'weekends', 'all_days', 'custom');--> statement-breakpoint
CREATE TYPE "public"."idp_type" AS ENUM('sso', 'scim');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_event_type" AS ENUM('join', 'move', 'leave');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_source" AS ENUM('manual', 'scim', 'sso', 'invite_code');--> statement-breakpoint
CREATE TYPE "public"."scim_provisioning_event_type" AS ENUM('user_created', 'user_updated', 'user_deactivated', 'user_reactivated', 'user_deleted', 'group_created', 'group_updated', 'group_deleted', 'group_member_added', 'group_member_removed', 'role_template_applied', 'error');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'success', 'failed', 'retrying');--> statement-breakpoint
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
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 60000,
	"rate_limit_max" integer DEFAULT 100,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
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
	"created_at" timestamp NOT NULL,
	"status" text DEFAULT 'approved',
	"invite_code_id" text
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
	"deleted_at" timestamp,
	"deleted_by" text,
	"sso_requires_approval" boolean DEFAULT true,
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
CREATE TABLE "scim_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"scim_token" text NOT NULL,
	"organization_id" text,
	CONSTRAINT "scim_provider_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "scim_provider_scim_token_unique" UNIQUE("scim_token")
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
	"pending_invite_code" text,
	"can_use_webapp" boolean DEFAULT true,
	"can_use_desktop" boolean DEFAULT true,
	"can_use_mobile" boolean DEFAULT true,
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
CREATE TABLE "access_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"ip_whitelist" jsonb,
	"ip_blacklist" jsonb,
	"allowed_countries" jsonb,
	"blocked_countries" jsonb,
	"require_trusted_device" boolean DEFAULT false NOT NULL,
	"require_passkey" boolean DEFAULT false NOT NULL,
	"require_mfa" boolean DEFAULT false NOT NULL,
	"require_hardware_mfa" boolean DEFAULT false NOT NULL,
	"max_session_duration_minutes" integer,
	"idle_timeout_minutes" integer,
	"allow_concurrent_sessions" boolean DEFAULT true NOT NULL,
	"max_concurrent_sessions" integer DEFAULT 5,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "access_violation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"session_id" text,
	"violation_type" "access_violation_type" NOT NULL,
	"policy_id" uuid,
	"ip_address" text,
	"country" text,
	"user_agent" text,
	"request_path" text,
	"request_method" text,
	"metadata" jsonb,
	"action_taken" "access_violation_action" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_extension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"trusted_device_id" uuid,
	"device_fingerprint" text,
	"country" text,
	"region" text,
	"city" text,
	"access_policy_id" uuid,
	"mfa_verified_at" timestamp,
	"mfa_method" text,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_extension_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "trusted_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"device_fingerprint" text NOT NULL,
	"device_name" text,
	"user_agent" text,
	"platform" text,
	"trust_source" "device_trust_source" NOT NULL,
	"passkey_id" text,
	"mdm_provider" text,
	"mdm_device_id" text,
	"mdm_compliant" boolean,
	"mdm_last_checked_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"last_ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
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
	"organization_id" text NOT NULL,
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
CREATE TABLE "audit_pack_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"audit_export_package_id" uuid,
	"s3_key" text,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"correction_node_count" integer DEFAULT 0 NOT NULL,
	"approval_event_count" integer DEFAULT 0 NOT NULL,
	"timeline_event_count" integer DEFAULT 0 NOT NULL,
	"expanded_node_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_pack_artifact_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "audit_pack_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" "audit_pack_status" DEFAULT 'requested' NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_export_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"retention_years" integer DEFAULT 10 NOT NULL,
	"retention_mode" "worm_retention_mode" DEFAULT 'governance' NOT NULL,
	"auto_enable_data_exports" boolean DEFAULT false NOT NULL,
	"auto_enable_payroll_exports" boolean DEFAULT false NOT NULL,
	"object_lock_supported" boolean DEFAULT false NOT NULL,
	"object_lock_checked_at" timestamp,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "audit_export_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "audit_export_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"sha256_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"merkle_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_export_package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"data_export_id" uuid,
	"payroll_export_job_id" uuid,
	"export_type" text NOT NULL,
	"status" "audit_export_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"s3_key" text,
	"file_size_bytes" integer,
	"merkle_root" text,
	"manifest_hash" text,
	"file_count" integer,
	"signature_algorithm" text DEFAULT 'Ed25519',
	"signature_value" text,
	"signing_key_id" uuid,
	"signed_at" timestamp,
	"timestamp_token" text,
	"timestamped_at" timestamp,
	"timestamp_authority" text DEFAULT 'freetsa.org',
	"retention_years" integer,
	"retention_until" timestamp,
	"object_lock_enabled" boolean DEFAULT false,
	"object_lock_mode" "worm_retention_mode",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processing_started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_signing_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"public_key" text NOT NULL,
	"algorithm" text DEFAULT 'Ed25519' NOT NULL,
	"fingerprint" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"rotated_at" timestamp,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_verification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"is_valid" boolean NOT NULL,
	"checks_performed" text[] NOT NULL,
	"checks_passed" text[] NOT NULL,
	"checks_failed" text[],
	"error_details" jsonb,
	"verified_by_id" text,
	"verification_source" text DEFAULT 'ui',
	"client_ip" text,
	"user_agent" text,
	"verified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_seat_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"action" text NOT NULL,
	"previous_seats" integer NOT NULL,
	"new_seats" integer NOT NULL,
	"member_id" text,
	"user_id" text,
	"stripe_reported" boolean DEFAULT false NOT NULL,
	"stripe_usage_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"organization_id" text,
	"data" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_event_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" text NOT NULL,
	"billing_interval" text,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"current_seats" integer DEFAULT 0 NOT NULL,
	"last_seat_reported_at" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "subscription_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"scope" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"conflict_detection_enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ics_feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"feed_type" "ics_feed_type" NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"secret" text NOT NULL,
	"include_approved" boolean DEFAULT true NOT NULL,
	"include_pending" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_accessed_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ics_feed_secret_unique" UNIQUE("secret")
);
--> statement-breakpoint
CREATE TABLE "organization_calendar_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"google_enabled" boolean DEFAULT true NOT NULL,
	"microsoft365_enabled" boolean DEFAULT true NOT NULL,
	"ics_feeds_enabled" boolean DEFAULT true NOT NULL,
	"team_ics_feeds_enabled" boolean DEFAULT true NOT NULL,
	"auto_sync_on_approval" boolean DEFAULT true NOT NULL,
	"conflict_detection_required" boolean DEFAULT false NOT NULL,
	"event_title_template" text DEFAULT 'Out of Office - {categoryName}',
	"event_description_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "organization_calendar_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "synced_absence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"absence_entry_id" uuid NOT NULL,
	"calendar_connection_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"external_calendar_id" text NOT NULL,
	"external_event_etag" text,
	"sync_status" "calendar_sync_status" DEFAULT 'synced' NOT NULL,
	"last_action" "calendar_sync_action" NOT NULL,
	"last_synced_at" timestamp NOT NULL,
	"sync_error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"self_service_days" integer DEFAULT 0 NOT NULL,
	"approval_days" integer DEFAULT 7 NOT NULL,
	"no_approval_required" boolean DEFAULT false NOT NULL,
	"notify_all_managers" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "change_policy_assignment" (
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
CREATE TABLE "clockodo_user_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"clockodo_user_id" integer NOT NULL,
	"clockodo_user_name" text NOT NULL,
	"clockodo_user_email" text NOT NULL,
	"user_id" text,
	"employee_id" uuid,
	"mapping_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "compliance_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"exception_type" "compliance_exception_type" NOT NULL,
	"status" "compliance_exception_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"planned_duration_minutes" integer,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"approver_id" uuid,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"was_used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"actual_duration_minutes" integer,
	"work_period_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_publish_compliance_ack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"published_range_start" timestamp with time zone NOT NULL,
	"published_range_end" timestamp with time zone NOT NULL,
	"warning_count_total" integer NOT NULL,
	"warning_counts_by_type" text NOT NULL,
	"evaluation_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverage_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"subarea_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"minimum_staff_count" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "coverage_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"allow_publish_with_gaps" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text,
	CONSTRAINT "coverage_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "cost_center" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_cost_center_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_job_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"bullmq_job_id" varchar(100),
	"status" varchar(20) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"result" jsonb,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"base_tier" "role" DEFAULT 'employee' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "custom_role_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"custom_role_id" uuid,
	"event_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_role_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"custom_role_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_custom_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"custom_role_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"vat_id" text,
	"email" text,
	"contact_person" text,
	"phone" text,
	"website" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "discord_approval_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_bot_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"application_id" text NOT NULL,
	"public_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"interaction_endpoint_configured" boolean DEFAULT false NOT NULL,
	"setup_status" text DEFAULT 'pending' NOT NULL,
	"enable_approvals" boolean DEFAULT true NOT NULL,
	"enable_commands" boolean DEFAULT true NOT NULL,
	"enable_daily_digest" boolean DEFAULT true NOT NULL,
	"enable_escalations" boolean DEFAULT true NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_timezone" text DEFAULT 'UTC' NOT NULL,
	"escalation_timeout_hours" integer DEFAULT 24 NOT NULL,
	"configured_by_user_id" text,
	"configured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"channel_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "discord_escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"original_approver_id" uuid NOT NULL,
	"escalated_to_approver_id" uuid NOT NULL,
	"escalated_at" timestamp DEFAULT now() NOT NULL,
	"timeout_hours" integer NOT NULL,
	"resolved_at" timestamp,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_link_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_by_discord_user_id" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_user_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"discord_username" text,
	"discord_display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_seen_at" timestamp
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
CREATE TABLE "organization_email_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"transport_type" text NOT NULL,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean DEFAULT true,
	"smtp_require_tls" boolean DEFAULT true,
	"smtp_username" text,
	"from_email" text NOT NULL,
	"from_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp,
	"last_test_success" boolean,
	"last_test_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_email_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_social_oauth" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"client_id" text NOT NULL,
	"provider_config" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp,
	"last_test_success" boolean,
	"last_test_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "role_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"name" text NOT NULL,
	"description" text,
	"is_global" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"employee_role" "role" DEFAULT 'employee' NOT NULL,
	"default_team_id" uuid,
	"team_permissions" jsonb DEFAULT '{}'::jsonb,
	"can_use_webapp" boolean DEFAULT true NOT NULL,
	"can_use_desktop" boolean DEFAULT true NOT NULL,
	"can_use_mobile" boolean DEFAULT true NOT NULL,
	"access_policy_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_template_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"idp_type" "idp_type" NOT NULL,
	"idp_group_id" text NOT NULL,
	"idp_group_name" text,
	"role_template_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_lifecycle_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"require_join_approval" boolean DEFAULT true NOT NULL,
	"auto_approve_via_scim" boolean DEFAULT false NOT NULL,
	"auto_approve_via_sso" boolean DEFAULT false NOT NULL,
	"require_move_approval" boolean DEFAULT false NOT NULL,
	"move_approver_role" "role" DEFAULT 'admin',
	"leave_action" text DEFAULT 'suspend' NOT NULL,
	"soft_delete_retention_days" integer DEFAULT 90,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_lifecycle_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "user_lifecycle_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"employee_id" uuid,
	"event_type" "lifecycle_event_type" NOT NULL,
	"source" "lifecycle_source" NOT NULL,
	"metadata" jsonb,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approval_status" text DEFAULT 'pending',
	"approved_by" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_role_template_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role_template_id" uuid NOT NULL,
	"assignment_source" "lifecycle_source" NOT NULL,
	"idp_group_id" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" text
);
--> statement-breakpoint
CREATE TABLE "invite_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"default_team_id" uuid,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"status" "invite_code_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "invite_code_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_code_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"status" "approval_status" NOT NULL,
	"assigned_team_id" uuid,
	"approved_by" text NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
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
	"contract_type" "contract_type" DEFAULT 'fixed' NOT NULL,
	"current_hourly_rate" numeric(10, 2),
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
CREATE TABLE "employee_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"reason" text,
	"created_by" text NOT NULL,
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
CREATE TABLE "payroll_export_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"format_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "payroll_export_format" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"requires_configuration" boolean DEFAULT true NOT NULL,
	"supports_async" boolean DEFAULT true NOT NULL,
	"sync_threshold" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_export_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"config_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"filters" jsonb NOT NULL,
	"is_async" boolean DEFAULT false NOT NULL,
	"status" "payroll_export_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"file_name" text,
	"s3_key" text,
	"file_size_bytes" integer,
	"work_period_count" integer,
	"employee_count" integer,
	"synced_record_count" integer,
	"failed_record_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payroll_export_sync_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" text NOT NULL,
	"external_id" text,
	"error_message" text,
	"is_retryable" boolean DEFAULT true,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"synced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payroll_wage_type_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"work_category_id" uuid,
	"absence_category_id" uuid,
	"special_category" text,
	"wage_type_code" text DEFAULT '' NOT NULL,
	"wage_type_name" text,
	"datev_wage_type_code" text,
	"datev_wage_type_name" text,
	"lexware_wage_type_code" text,
	"lexware_wage_type_name" text,
	"sage_wage_type_code" text,
	"sage_wage_type_name" text,
	"successfactors_time_type_code" text,
	"successfactors_time_type_name" text,
	"factor" numeric(4, 2) DEFAULT '1.00',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_suspension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"reason" text NOT NULL,
	"suspended_by" text NOT NULL,
	"suspended_at" timestamp DEFAULT now() NOT NULL,
	"unsuspended_at" timestamp,
	"unsuspended_by" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"customer_id" uuid,
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
CREATE TABLE "scheduled_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schedule_type" "scheduled_export_schedule_type" NOT NULL,
	"cron_expression" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"report_type" "scheduled_export_report_type" NOT NULL,
	"report_config" jsonb NOT NULL,
	"payroll_config_id" uuid,
	"filters" jsonb,
	"date_range_strategy" "scheduled_export_date_range_strategy" NOT NULL,
	"custom_offset" jsonb,
	"delivery_method" "scheduled_export_delivery_method" DEFAULT 's3_and_email' NOT NULL,
	"email_recipients" text[] NOT NULL,
	"email_subject_template" text,
	"use_org_s3_config" boolean DEFAULT true NOT NULL,
	"custom_s3_prefix" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_execution_at" timestamp with time zone,
	"next_execution_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_export_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_export_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"date_range_start" text NOT NULL,
	"date_range_end" text NOT NULL,
	"status" "scheduled_export_execution_status" DEFAULT 'pending' NOT NULL,
	"underlying_job_id" uuid,
	"underlying_job_type" text,
	"s3_key" text,
	"s3_url" text,
	"file_size_bytes" integer,
	"record_count" integer,
	"emails_sent" integer DEFAULT 0,
	"emails_failed" integer DEFAULT 0,
	"email_errors" jsonb,
	"error_message" text,
	"error_stack" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "scim_provider_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"auto_activate_users" boolean DEFAULT false NOT NULL,
	"deprovision_action" text DEFAULT 'suspend' NOT NULL,
	"default_role_template_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "scim_provider_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "scim_provisioning_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"event_type" "scim_provisioning_event_type" NOT NULL,
	"user_id" text,
	"team_id" uuid,
	"external_id" text,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid,
	"template_id" uuid,
	"subarea_id" uuid NOT NULL,
	"recurrence_id" uuid,
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
CREATE TABLE "shift_recurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" uuid,
	"subarea_id" uuid NOT NULL,
	"recurrence_type" "shift_recurrence_type" NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"color" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"weekly_days" text,
	"biweekly_week" integer,
	"monthly_day_of_month" integer,
	"custom_interval" integer,
	"custom_interval_unit" text,
	"last_generated_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
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
	"subarea_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"expires_at" timestamp,
	"notes" text,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_template_skill_requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "skill_category" NOT NULL,
	"custom_category_name" text,
	"requires_expiry" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "skill_requirement_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"missing_skill_ids" text NOT NULL,
	"override_reason" text NOT NULL,
	"overridden_by" text NOT NULL,
	"overridden_at" timestamp DEFAULT now() NOT NULL,
	"notification_sent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subarea_skill_requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subarea_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_approval_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"message_ts" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"channel_id" text NOT NULL,
	"channel_type" text DEFAULT 'im' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "slack_escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"original_approver_id" uuid NOT NULL,
	"escalated_to_approver_id" uuid NOT NULL,
	"escalated_at" timestamp DEFAULT now() NOT NULL,
	"timeout_hours" integer NOT NULL,
	"resolved_at" timestamp,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_link_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_by_slack_user_id" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_oauth_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_token" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_user_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_username" text,
	"slack_display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "slack_workspace_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_team_name" text,
	"bot_access_token" text NOT NULL,
	"bot_user_id" text,
	"setup_status" text DEFAULT 'active' NOT NULL,
	"enable_approvals" boolean DEFAULT true NOT NULL,
	"enable_commands" boolean DEFAULT true NOT NULL,
	"enable_daily_digest" boolean DEFAULT true NOT NULL,
	"enable_escalations" boolean DEFAULT true NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_timezone" text DEFAULT 'UTC' NOT NULL,
	"escalation_timeout_hours" integer DEFAULT 24 NOT NULL,
	"configured_by_user_id" text,
	"configured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
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
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams_approval_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"teams_message_id" text NOT NULL,
	"teams_conversation_id" text NOT NULL,
	"teams_activity_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"conversation_reference" text NOT NULL,
	"teams_conversation_id" text NOT NULL,
	"teams_service_url" text NOT NULL,
	"teams_tenant_id" text NOT NULL,
	"conversation_type" text DEFAULT 'personal' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "teams_escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"original_approver_id" uuid NOT NULL,
	"escalated_to_approver_id" uuid NOT NULL,
	"escalated_at" timestamp DEFAULT now() NOT NULL,
	"timeout_hours" integer NOT NULL,
	"resolved_at" timestamp,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams_tenant_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text,
	"organization_id" text NOT NULL,
	"setup_status" text DEFAULT 'pending' NOT NULL,
	"enable_approvals" boolean DEFAULT true NOT NULL,
	"enable_commands" boolean DEFAULT true NOT NULL,
	"enable_daily_digest" boolean DEFAULT true NOT NULL,
	"enable_escalations" boolean DEFAULT true NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_timezone" text DEFAULT 'UTC' NOT NULL,
	"escalation_timeout_hours" integer DEFAULT 24 NOT NULL,
	"configured_by_user_id" text,
	"configured_at" timestamp,
	"service_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "teams_tenant_config_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "teams_user_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"teams_user_id" text NOT NULL,
	"teams_email" text NOT NULL,
	"teams_tenant_id" text NOT NULL,
	"teams_display_name" text,
	"teams_user_principal_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "telegram_approval_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_bot_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"bot_username" text,
	"bot_display_name" text,
	"webhook_secret" text NOT NULL,
	"webhook_registered" boolean DEFAULT false NOT NULL,
	"setup_status" text DEFAULT 'pending' NOT NULL,
	"enable_approvals" boolean DEFAULT true NOT NULL,
	"enable_commands" boolean DEFAULT true NOT NULL,
	"enable_daily_digest" boolean DEFAULT true NOT NULL,
	"enable_escalations" boolean DEFAULT true NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_timezone" text DEFAULT 'UTC' NOT NULL,
	"escalation_timeout_hours" integer DEFAULT 24 NOT NULL,
	"configured_by_user_id" text,
	"configured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"chat_id" text NOT NULL,
	"chat_type" text DEFAULT 'private' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "telegram_escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"original_approver_id" uuid NOT NULL,
	"escalated_to_approver_id" uuid NOT NULL,
	"escalated_at" timestamp DEFAULT now() NOT NULL,
	"timeout_hours" integer NOT NULL,
	"resolved_at" timestamp,
	"resolution" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_by_telegram_user_id" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_user_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"telegram_username" text,
	"telegram_display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
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
	"organization_id" text NOT NULL,
	"clock_in_id" uuid NOT NULL,
	"clock_out_id" uuid,
	"project_id" uuid,
	"work_category_id" uuid,
	"work_location_type" "work_location_type",
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"approval_status" "approval_status" DEFAULT 'approved' NOT NULL,
	"pending_changes" text,
	"was_auto_adjusted" boolean DEFAULT false NOT NULL,
	"auto_adjustment_reason" text,
	"auto_adjusted_at" timestamp with time zone,
	"original_end_time" timestamp with time zone,
	"original_duration_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dashboard_widget_order" jsonb,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"onboarding_step" text,
	"onboarding_started_at" timestamp,
	"onboarding_completed_at" timestamp,
	"water_reminder_enabled" boolean DEFAULT false NOT NULL,
	"water_reminder_preset" text DEFAULT 'moderate' NOT NULL,
	"water_reminder_interval_minutes" integer DEFAULT 45 NOT NULL,
	"water_reminder_daily_goal" integer DEFAULT 8 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
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
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_endpoint_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"event_type" "notification_type" NOT NULL,
	"event_id" text,
	"url" text NOT NULL,
	"payload" jsonb NOT NULL,
	"request_headers" jsonb,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"response_body" text,
	"error_message" text,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"bullmq_job_id" varchar(100),
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"subscribed_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"total_successes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "work_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"factor" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "work_category_set" (
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
CREATE TABLE "work_category_set_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
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
CREATE TABLE "work_category_set_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schedule_enabled" boolean DEFAULT true NOT NULL,
	"regulation_enabled" boolean DEFAULT true NOT NULL,
	"presence_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "work_policy_assignment" (
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
CREATE TABLE "work_policy_break_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"break_rule_id" uuid NOT NULL,
	"split_count" integer,
	"minimum_split_minutes" integer,
	"minimum_longest_split_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_policy_break_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regulation_id" uuid NOT NULL,
	"working_minutes_threshold" integer NOT NULL,
	"required_break_minutes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_policy_presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"presence_mode" "presence_mode" DEFAULT 'minimum_count' NOT NULL,
	"required_onsite_days" integer,
	"required_onsite_fixed_days" text,
	"location_id" uuid,
	"evaluation_period" "presence_evaluation_period" DEFAULT 'weekly' NOT NULL,
	"enforcement" "presence_enforcement" DEFAULT 'warn' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "work_policy_presence_policy_id_unique" UNIQUE("policy_id")
);
--> statement-breakpoint
CREATE TABLE "work_policy_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"country_code" text,
	"schedule_cycle" "schedule_cycle" DEFAULT 'weekly',
	"working_days_preset" "working_days_preset" DEFAULT 'weekdays',
	"hours_per_cycle" numeric(6, 2),
	"max_daily_minutes" integer,
	"max_weekly_minutes" integer,
	"max_uninterrupted_minutes" integer,
	"break_rules_json" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_policy_preset_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "work_policy_regulation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"max_daily_minutes" integer,
	"max_weekly_minutes" integer,
	"max_uninterrupted_minutes" integer,
	"min_rest_period_minutes" integer,
	"rest_period_enforcement" "rest_period_enforcement" DEFAULT 'warn',
	"overtime_daily_threshold_minutes" integer,
	"overtime_weekly_threshold_minutes" integer,
	"overtime_monthly_threshold_minutes" integer,
	"alert_before_limit_minutes" integer DEFAULT 30,
	"alert_threshold_percent" integer DEFAULT 80,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "work_policy_regulation_policy_id_unique" UNIQUE("policy_id")
);
--> statement-breakpoint
CREATE TABLE "work_policy_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"schedule_cycle" "schedule_cycle" DEFAULT 'weekly' NOT NULL,
	"schedule_type" "schedule_type" DEFAULT 'simple' NOT NULL,
	"working_days_preset" "working_days_preset" DEFAULT 'weekdays' NOT NULL,
	"hours_per_cycle" numeric(6, 2),
	"home_office_days_per_cycle" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "work_policy_schedule_policy_id_unique" UNIQUE("policy_id")
);
--> statement-breakpoint
CREATE TABLE "work_policy_schedule_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"hours_per_day" numeric(4, 2) NOT NULL,
	"is_work_day" boolean DEFAULT true NOT NULL,
	"cycle_week" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_policy_violation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid,
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
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "access_policy" ADD CONSTRAINT "access_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_policy" ADD CONSTRAINT "access_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_policy" ADD CONSTRAINT "access_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_violation_log" ADD CONSTRAINT "access_violation_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_violation_log" ADD CONSTRAINT "access_violation_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_violation_log" ADD CONSTRAINT "access_violation_log_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_violation_log" ADD CONSTRAINT "access_violation_log_policy_id_access_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."access_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_extension" ADD CONSTRAINT "session_extension_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_extension" ADD CONSTRAINT "session_extension_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_extension" ADD CONSTRAINT "session_extension_trusted_device_id_trusted_device_id_fk" FOREIGN KEY ("trusted_device_id") REFERENCES "public"."trusted_device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_extension" ADD CONSTRAINT "session_extension_access_policy_id_access_policy_id_fk" FOREIGN KEY ("access_policy_id") REFERENCES "public"."access_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_passkey_id_passkey_id_fk" FOREIGN KEY ("passkey_id") REFERENCES "public"."passkey"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_employee_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pack_artifact" ADD CONSTRAINT "audit_pack_artifact_request_id_audit_pack_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."audit_pack_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pack_artifact" ADD CONSTRAINT "audit_pack_artifact_audit_export_package_id_audit_export_package_id_fk" FOREIGN KEY ("audit_export_package_id") REFERENCES "public"."audit_export_package"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pack_request" ADD CONSTRAINT "audit_pack_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pack_request" ADD CONSTRAINT "audit_pack_request_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_config" ADD CONSTRAINT "audit_export_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_config" ADD CONSTRAINT "audit_export_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_file" ADD CONSTRAINT "audit_export_file_package_id_audit_export_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."audit_export_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_package" ADD CONSTRAINT "audit_export_package_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_package" ADD CONSTRAINT "audit_export_package_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_package" ADD CONSTRAINT "audit_export_package_data_export_id_data_export_id_fk" FOREIGN KEY ("data_export_id") REFERENCES "public"."data_export"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_package" ADD CONSTRAINT "audit_export_package_payroll_export_job_id_payroll_export_job_id_fk" FOREIGN KEY ("payroll_export_job_id") REFERENCES "public"."payroll_export_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_package" ADD CONSTRAINT "audit_export_package_signing_key_id_audit_signing_key_id_fk" FOREIGN KEY ("signing_key_id") REFERENCES "public"."audit_signing_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_signing_key" ADD CONSTRAINT "audit_signing_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_verification_log" ADD CONSTRAINT "audit_verification_log_package_id_audit_export_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."audit_export_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_verification_log" ADD CONSTRAINT "audit_verification_log_verified_by_id_user_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_seat_audit" ADD CONSTRAINT "billing_seat_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_seat_audit" ADD CONSTRAINT "billing_seat_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_seat_audit" ADD CONSTRAINT "billing_seat_audit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_event" ADD CONSTRAINT "stripe_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD CONSTRAINT "ics_feed_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD CONSTRAINT "ics_feed_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD CONSTRAINT "ics_feed_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD CONSTRAINT "ics_feed_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_calendar_settings" ADD CONSTRAINT "organization_calendar_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_absence" ADD CONSTRAINT "synced_absence_absence_entry_id_absence_entry_id_fk" FOREIGN KEY ("absence_entry_id") REFERENCES "public"."absence_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_absence" ADD CONSTRAINT "synced_absence_calendar_connection_id_calendar_connection_id_fk" FOREIGN KEY ("calendar_connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy" ADD CONSTRAINT "change_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy" ADD CONSTRAINT "change_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy" ADD CONSTRAINT "change_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_policy_id_change_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."change_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clockodo_user_mapping" ADD CONSTRAINT "clockodo_user_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clockodo_user_mapping" ADD CONSTRAINT "clockodo_user_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clockodo_user_mapping" ADD CONSTRAINT "clockodo_user_mapping_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clockodo_user_mapping" ADD CONSTRAINT "clockodo_user_mapping_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_work_period_id_work_period_id_fk" FOREIGN KEY ("work_period_id") REFERENCES "public"."work_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_publish_compliance_ack" ADD CONSTRAINT "schedule_publish_compliance_ack_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_publish_compliance_ack" ADD CONSTRAINT "schedule_publish_compliance_ack_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_rule" ADD CONSTRAINT "coverage_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_rule" ADD CONSTRAINT "coverage_rule_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_rule" ADD CONSTRAINT "coverage_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_rule" ADD CONSTRAINT "coverage_rule_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_settings" ADD CONSTRAINT "coverage_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_settings" ADD CONSTRAINT "coverage_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_center" ADD CONSTRAINT "cost_center_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_center_assignment" ADD CONSTRAINT "employee_cost_center_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_center_assignment" ADD CONSTRAINT "employee_cost_center_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_center_assignment" ADD CONSTRAINT "employee_cost_center_assignment_cost_center_id_cost_center_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_center"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role" ADD CONSTRAINT "custom_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role" ADD CONSTRAINT "custom_role_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role" ADD CONSTRAINT "custom_role_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role_audit_log" ADD CONSTRAINT "custom_role_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role_audit_log" ADD CONSTRAINT "custom_role_audit_log_custom_role_id_custom_role_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role_audit_log" ADD CONSTRAINT "custom_role_audit_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role_permission" ADD CONSTRAINT "custom_role_permission_custom_role_id_custom_role_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_custom_role" ADD CONSTRAINT "employee_custom_role_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_custom_role" ADD CONSTRAINT "employee_custom_role_custom_role_id_custom_role_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_custom_role" ADD CONSTRAINT "employee_custom_role_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_approval_message" ADD CONSTRAINT "discord_approval_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_approval_message" ADD CONSTRAINT "discord_approval_message_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_approval_message" ADD CONSTRAINT "discord_approval_message_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bot_config" ADD CONSTRAINT "discord_bot_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bot_config" ADD CONSTRAINT "discord_bot_config_configured_by_user_id_user_id_fk" FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_conversation" ADD CONSTRAINT "discord_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_conversation" ADD CONSTRAINT "discord_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_escalation" ADD CONSTRAINT "discord_escalation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_escalation" ADD CONSTRAINT "discord_escalation_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_escalation" ADD CONSTRAINT "discord_escalation_original_approver_id_employee_id_fk" FOREIGN KEY ("original_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_escalation" ADD CONSTRAINT "discord_escalation_escalated_to_approver_id_employee_id_fk" FOREIGN KEY ("escalated_to_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_link_code" ADD CONSTRAINT "discord_link_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_link_code" ADD CONSTRAINT "discord_link_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_user_mapping" ADD CONSTRAINT "discord_user_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_user_mapping" ADD CONSTRAINT "discord_user_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_email_config" ADD CONSTRAINT "organization_email_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_social_oauth" ADD CONSTRAINT "organization_social_oauth_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "role_template" ADD CONSTRAINT "role_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_template" ADD CONSTRAINT "role_template_default_team_id_team_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_template" ADD CONSTRAINT "role_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_template_mapping" ADD CONSTRAINT "role_template_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_template_mapping" ADD CONSTRAINT "role_template_mapping_role_template_id_role_template_id_fk" FOREIGN KEY ("role_template_id") REFERENCES "public"."role_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_template_mapping" ADD CONSTRAINT "role_template_mapping_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lifecycle_config" ADD CONSTRAINT "user_lifecycle_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD CONSTRAINT "user_lifecycle_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD CONSTRAINT "user_lifecycle_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD CONSTRAINT "user_lifecycle_event_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD CONSTRAINT "user_lifecycle_event_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD CONSTRAINT "user_lifecycle_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_template_assignment" ADD CONSTRAINT "user_role_template_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_template_assignment" ADD CONSTRAINT "user_role_template_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_template_assignment" ADD CONSTRAINT "user_role_template_assignment_role_template_id_role_template_id_fk" FOREIGN KEY ("role_template_id") REFERENCES "public"."role_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_template_assignment" ADD CONSTRAINT "user_role_template_assignment_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_default_team_id_team_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code_usage" ADD CONSTRAINT "invite_code_usage_invite_code_id_invite_code_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."invite_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code_usage" ADD CONSTRAINT "invite_code_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code_usage" ADD CONSTRAINT "invite_code_usage_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_approval" ADD CONSTRAINT "member_approval_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_approval" ADD CONSTRAINT "member_approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_approval" ADD CONSTRAINT "member_approval_assigned_team_id_team_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_approval" ADD CONSTRAINT "member_approval_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_managers" ADD CONSTRAINT "employee_managers_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_managers" ADD CONSTRAINT "employee_managers_manager_id_employee_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_managers" ADD CONSTRAINT "employee_managers_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "payroll_export_config" ADD CONSTRAINT "payroll_export_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ADD CONSTRAINT "payroll_export_config_format_id_payroll_export_format_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."payroll_export_format"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ADD CONSTRAINT "payroll_export_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ADD CONSTRAINT "payroll_export_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD CONSTRAINT "payroll_export_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD CONSTRAINT "payroll_export_job_config_id_payroll_export_config_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."payroll_export_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD CONSTRAINT "payroll_export_job_requested_by_id_employee_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_sync_record" ADD CONSTRAINT "payroll_export_sync_record_job_id_payroll_export_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."payroll_export_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" ADD CONSTRAINT "payroll_wage_type_mapping_config_id_payroll_export_config_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."payroll_export_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" ADD CONSTRAINT "payroll_wage_type_mapping_work_category_id_work_category_id_fk" FOREIGN KEY ("work_category_id") REFERENCES "public"."work_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" ADD CONSTRAINT "payroll_wage_type_mapping_absence_category_id_absence_category_id_fk" FOREIGN KEY ("absence_category_id") REFERENCES "public"."absence_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" ADD CONSTRAINT "payroll_wage_type_mapping_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_suspension" ADD CONSTRAINT "organization_suspension_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_suspension" ADD CONSTRAINT "organization_suspension_suspended_by_user_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_suspension" ADD CONSTRAINT "organization_suspension_unsuspended_by_user_id_fk" FOREIGN KEY ("unsuspended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_audit_log" ADD CONSTRAINT "platform_admin_audit_log_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_payroll_config_id_payroll_export_config_id_fk" FOREIGN KEY ("payroll_config_id") REFERENCES "public"."payroll_export_config"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export_execution" ADD CONSTRAINT "scheduled_export_execution_scheduled_export_id_scheduled_export_id_fk" FOREIGN KEY ("scheduled_export_id") REFERENCES "public"."scheduled_export"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export_execution" ADD CONSTRAINT "scheduled_export_execution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD CONSTRAINT "scim_provider_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD CONSTRAINT "scim_provider_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD CONSTRAINT "scim_provider_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_provisioning_log" ADD CONSTRAINT "scim_provisioning_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_provisioning_log" ADD CONSTRAINT "scim_provisioning_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_template_id_shift_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_recurrence_id_shift_recurrence_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."shift_recurrence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_recurrence" ADD CONSTRAINT "shift_recurrence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_recurrence" ADD CONSTRAINT "shift_recurrence_template_id_shift_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_recurrence" ADD CONSTRAINT "shift_recurrence_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_recurrence" ADD CONSTRAINT "shift_recurrence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_requester_id_employee_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_target_employee_id_employee_id_fk" FOREIGN KEY ("target_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template" ADD CONSTRAINT "shift_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template" ADD CONSTRAINT "shift_template_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template" ADD CONSTRAINT "shift_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill" ADD CONSTRAINT "employee_skill_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template_skill_requirement" ADD CONSTRAINT "shift_template_skill_requirement_template_id_shift_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template_skill_requirement" ADD CONSTRAINT "shift_template_skill_requirement_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_template_skill_requirement" ADD CONSTRAINT "shift_template_skill_requirement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD CONSTRAINT "skill_requirement_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD CONSTRAINT "skill_requirement_override_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD CONSTRAINT "skill_requirement_override_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirement_override" ADD CONSTRAINT "skill_requirement_override_overridden_by_user_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subarea_skill_requirement" ADD CONSTRAINT "subarea_skill_requirement_subarea_id_location_subarea_id_fk" FOREIGN KEY ("subarea_id") REFERENCES "public"."location_subarea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subarea_skill_requirement" ADD CONSTRAINT "subarea_skill_requirement_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subarea_skill_requirement" ADD CONSTRAINT "subarea_skill_requirement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_message" ADD CONSTRAINT "slack_approval_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_message" ADD CONSTRAINT "slack_approval_message_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_message" ADD CONSTRAINT "slack_approval_message_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation" ADD CONSTRAINT "slack_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation" ADD CONSTRAINT "slack_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_escalation" ADD CONSTRAINT "slack_escalation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_escalation" ADD CONSTRAINT "slack_escalation_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_escalation" ADD CONSTRAINT "slack_escalation_original_approver_id_employee_id_fk" FOREIGN KEY ("original_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_escalation" ADD CONSTRAINT "slack_escalation_escalated_to_approver_id_employee_id_fk" FOREIGN KEY ("escalated_to_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_link_code" ADD CONSTRAINT "slack_link_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_link_code" ADD CONSTRAINT "slack_link_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_state" ADD CONSTRAINT "slack_oauth_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_state" ADD CONSTRAINT "slack_oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_mapping" ADD CONSTRAINT "slack_user_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_mapping" ADD CONSTRAINT "slack_user_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspace_config" ADD CONSTRAINT "slack_workspace_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspace_config" ADD CONSTRAINT "slack_workspace_config_configured_by_user_id_user_id_fk" FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "teams_approval_card" ADD CONSTRAINT "teams_approval_card_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_approval_card" ADD CONSTRAINT "teams_approval_card_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_approval_card" ADD CONSTRAINT "teams_approval_card_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_conversation" ADD CONSTRAINT "teams_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_conversation" ADD CONSTRAINT "teams_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_escalation" ADD CONSTRAINT "teams_escalation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_escalation" ADD CONSTRAINT "teams_escalation_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_escalation" ADD CONSTRAINT "teams_escalation_original_approver_id_employee_id_fk" FOREIGN KEY ("original_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_escalation" ADD CONSTRAINT "teams_escalation_escalated_to_approver_id_employee_id_fk" FOREIGN KEY ("escalated_to_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_tenant_config" ADD CONSTRAINT "teams_tenant_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_tenant_config" ADD CONSTRAINT "teams_tenant_config_configured_by_user_id_user_id_fk" FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_user_mapping" ADD CONSTRAINT "teams_user_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_user_mapping" ADD CONSTRAINT "teams_user_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_approval_message" ADD CONSTRAINT "telegram_approval_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_approval_message" ADD CONSTRAINT "telegram_approval_message_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_approval_message" ADD CONSTRAINT "telegram_approval_message_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bot_config" ADD CONSTRAINT "telegram_bot_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bot_config" ADD CONSTRAINT "telegram_bot_config_configured_by_user_id_user_id_fk" FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_conversation" ADD CONSTRAINT "telegram_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_conversation" ADD CONSTRAINT "telegram_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_escalation" ADD CONSTRAINT "telegram_escalation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_escalation" ADD CONSTRAINT "telegram_escalation_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_escalation" ADD CONSTRAINT "telegram_escalation_original_approver_id_employee_id_fk" FOREIGN KEY ("original_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_escalation" ADD CONSTRAINT "telegram_escalation_escalated_to_approver_id_employee_id_fk" FOREIGN KEY ("escalated_to_approver_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_code" ADD CONSTRAINT "telegram_link_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_code" ADD CONSTRAINT "telegram_link_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_user_mapping" ADD CONSTRAINT "telegram_user_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_user_mapping" ADD CONSTRAINT "telegram_user_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_clock_in_id_time_entry_id_fk" FOREIGN KEY ("clock_in_id") REFERENCES "public"."time_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_clock_out_id_time_entry_id_fk" FOREIGN KEY ("clock_out_id") REFERENCES "public"."time_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_work_category_id_work_category_id_fk" FOREIGN KEY ("work_category_id") REFERENCES "public"."work_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hydration_stats" ADD CONSTRAINT "hydration_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_intake_log" ADD CONSTRAINT "water_intake_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category" ADD CONSTRAINT "work_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category" ADD CONSTRAINT "work_category_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category" ADD CONSTRAINT "work_category_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set" ADD CONSTRAINT "work_category_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set" ADD CONSTRAINT "work_category_set_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set" ADD CONSTRAINT "work_category_set_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_assignment" ADD CONSTRAINT "work_category_set_assignment_set_id_work_category_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."work_category_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_assignment" ADD CONSTRAINT "work_category_set_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_assignment" ADD CONSTRAINT "work_category_set_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_assignment" ADD CONSTRAINT "work_category_set_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_assignment" ADD CONSTRAINT "work_category_set_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_category" ADD CONSTRAINT "work_category_set_category_set_id_work_category_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."work_category_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_category_set_category" ADD CONSTRAINT "work_category_set_category_category_id_work_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."work_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy" ADD CONSTRAINT "work_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy" ADD CONSTRAINT "work_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy" ADD CONSTRAINT "work_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_policy_id_work_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."work_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_break_option" ADD CONSTRAINT "work_policy_break_option_break_rule_id_work_policy_break_rule_id_fk" FOREIGN KEY ("break_rule_id") REFERENCES "public"."work_policy_break_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_break_rule" ADD CONSTRAINT "work_policy_break_rule_regulation_id_work_policy_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."work_policy_regulation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_presence" ADD CONSTRAINT "work_policy_presence_policy_id_work_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."work_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_presence" ADD CONSTRAINT "work_policy_presence_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD CONSTRAINT "work_policy_regulation_policy_id_work_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."work_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_schedule" ADD CONSTRAINT "work_policy_schedule_policy_id_work_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."work_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_schedule_day" ADD CONSTRAINT "work_policy_schedule_day_schedule_id_work_policy_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_policy_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_policy_id_work_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."work_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_work_period_id_work_period_id_fk" FOREIGN KEY ("work_period_id") REFERENCES "public"."work_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_acknowledged_by_employee_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
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
CREATE INDEX "accessPolicy_organizationId_idx" ON "access_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "accessPolicy_enabled_idx" ON "access_policy" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "accessPolicy_priority_idx" ON "access_policy" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "accessViolationLog_organizationId_idx" ON "access_violation_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "accessViolationLog_userId_idx" ON "access_violation_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accessViolationLog_violationType_idx" ON "access_violation_log" USING btree ("violation_type");--> statement-breakpoint
CREATE INDEX "accessViolationLog_createdAt_idx" ON "access_violation_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "accessViolationLog_policyId_idx" ON "access_violation_log" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "sessionExtension_sessionId_idx" ON "session_extension" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessionExtension_organizationId_idx" ON "session_extension" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sessionExtension_trustedDeviceId_idx" ON "session_extension" USING btree ("trusted_device_id");--> statement-breakpoint
CREATE INDEX "sessionExtension_lastActivityAt_idx" ON "session_extension" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "trustedDevice_userId_idx" ON "trusted_device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trustedDevice_organizationId_idx" ON "trusted_device" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "trustedDevice_isActive_idx" ON "trusted_device" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "trustedDevice_fingerprint_idx" ON "trusted_device" USING btree ("device_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "trustedDevice_user_org_fingerprint_idx" ON "trusted_device" USING btree ("user_id","organization_id","device_fingerprint");--> statement-breakpoint
CREATE INDEX "approvalRequest_organizationId_idx" ON "approval_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "approvalRequest_entityType_entityId_idx" ON "approval_request" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approvalRequest_approverId_idx" ON "approval_request" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "approvalRequest_status_idx" ON "approval_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auditLog_organizationId_idx" ON "audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auditLog_organizationId_timestamp_idx" ON "audit_log" USING btree ("organization_id","timestamp");--> statement-breakpoint
CREATE INDEX "auditLog_entityType_entityId_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "auditLog_performedBy_idx" ON "audit_log" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "auditLog_timestamp_idx" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "auditPackArtifact_requestId_idx" ON "audit_pack_artifact" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "auditPackArtifact_auditExportPackageId_idx" ON "audit_pack_artifact" USING btree ("audit_export_package_id");--> statement-breakpoint
CREATE INDEX "auditPackRequest_organizationId_idx" ON "audit_pack_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auditPackRequest_status_idx" ON "audit_pack_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auditPackRequest_createdAt_idx" ON "audit_pack_request" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auditExportConfig_organizationId_idx" ON "audit_export_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auditExportFile_packageId_idx" ON "audit_export_file" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "auditExportFile_sha256Hash_idx" ON "audit_export_file" USING btree ("sha256_hash");--> statement-breakpoint
CREATE INDEX "auditExportPackage_organizationId_idx" ON "audit_export_package" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auditExportPackage_dataExportId_idx" ON "audit_export_package" USING btree ("data_export_id");--> statement-breakpoint
CREATE INDEX "auditExportPackage_payrollExportJobId_idx" ON "audit_export_package" USING btree ("payroll_export_job_id");--> statement-breakpoint
CREATE INDEX "auditExportPackage_status_idx" ON "audit_export_package" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auditExportPackage_createdAt_idx" ON "audit_export_package" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auditExportPackage_merkleRoot_idx" ON "audit_export_package" USING btree ("merkle_root");--> statement-breakpoint
CREATE INDEX "auditSigningKey_organizationId_idx" ON "audit_signing_key" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auditSigningKey_isActive_idx" ON "audit_signing_key" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "auditSigningKey_fingerprint_idx" ON "audit_signing_key" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "auditVerificationLog_packageId_idx" ON "audit_verification_log" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "auditVerificationLog_isValid_idx" ON "audit_verification_log" USING btree ("is_valid");--> statement-breakpoint
CREATE INDEX "auditVerificationLog_verifiedAt_idx" ON "audit_verification_log" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "billing_seat_audit_organization_id_idx" ON "billing_seat_audit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_seat_audit_created_at_idx" ON "billing_seat_audit" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_event_stripe_event_id_idx" ON "stripe_event" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "stripe_event_processed_idx" ON "stripe_event" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "stripe_event_type_idx" ON "stripe_event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "subscription_organization_id_idx" ON "subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "subscription" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_customer_id_idx" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "calendarConnection_employeeId_idx" ON "calendar_connection" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "calendarConnection_organizationId_idx" ON "calendar_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "calendarConnection_provider_idx" ON "calendar_connection" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "calendarConnection_employee_provider_idx" ON "calendar_connection" USING btree ("employee_id","provider");--> statement-breakpoint
CREATE INDEX "icsFeed_organizationId_idx" ON "ics_feed" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "icsFeed_employeeId_idx" ON "ics_feed" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "icsFeed_teamId_idx" ON "ics_feed" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "icsFeed_secret_idx" ON "ics_feed" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "organizationCalendarSettings_organizationId_idx" ON "organization_calendar_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "syncedAbsence_absenceEntryId_idx" ON "synced_absence" USING btree ("absence_entry_id");--> statement-breakpoint
CREATE INDEX "syncedAbsence_calendarConnectionId_idx" ON "synced_absence" USING btree ("calendar_connection_id");--> statement-breakpoint
CREATE INDEX "syncedAbsence_syncStatus_idx" ON "synced_absence" USING btree ("sync_status");--> statement-breakpoint
CREATE UNIQUE INDEX "syncedAbsence_absence_connection_idx" ON "synced_absence" USING btree ("absence_entry_id","calendar_connection_id");--> statement-breakpoint
CREATE INDEX "changePolicy_organizationId_idx" ON "change_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "changePolicy_isActive_idx" ON "change_policy" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "changePolicy_org_name_idx" ON "change_policy" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_policyId_idx" ON "change_policy_assignment" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_organizationId_idx" ON "change_policy_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_teamId_idx" ON "change_policy_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_employeeId_idx" ON "change_policy_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_resolution_idx" ON "change_policy_assignment" USING btree ("organization_id","assignment_type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "changePolicyAssignment_org_default_idx" ON "change_policy_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "changePolicyAssignment_team_idx" ON "change_policy_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "changePolicyAssignment_employee_idx" ON "change_policy_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "clockodoUserMapping_org_clockodoUser_unique_idx" ON "clockodo_user_mapping" USING btree ("organization_id","clockodo_user_id");--> statement-breakpoint
CREATE INDEX "clockodoUserMapping_organizationId_idx" ON "clockodo_user_mapping" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clockodoUserMapping_employeeId_idx" ON "clockodo_user_mapping" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "complianceException_organizationId_idx" ON "compliance_exception" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "complianceException_employeeId_idx" ON "compliance_exception" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "complianceException_status_idx" ON "compliance_exception" USING btree ("status");--> statement-breakpoint
CREATE INDEX "complianceException_exceptionType_idx" ON "compliance_exception" USING btree ("exception_type");--> statement-breakpoint
CREATE INDEX "complianceException_validFrom_idx" ON "compliance_exception" USING btree ("valid_from");--> statement-breakpoint
CREATE INDEX "complianceException_validUntil_idx" ON "compliance_exception" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "complianceException_emp_status_validUntil_idx" ON "compliance_exception" USING btree ("employee_id","status","valid_until");--> statement-breakpoint
CREATE INDEX "complianceException_org_status_idx" ON "compliance_exception" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "schedulePublishComplianceAck_org_createdAt_idx" ON "schedule_publish_compliance_ack" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "schedulePublishComplianceAck_actor_createdAt_idx" ON "schedule_publish_compliance_ack" USING btree ("actor_employee_id","created_at");--> statement-breakpoint
CREATE INDEX "schedulePublishComplianceAck_org_rangeStart_idx" ON "schedule_publish_compliance_ack" USING btree ("organization_id","published_range_start");--> statement-breakpoint
CREATE INDEX "coverageRule_organizationId_idx" ON "coverage_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "coverageRule_subareaId_idx" ON "coverage_rule" USING btree ("subarea_id");--> statement-breakpoint
CREATE INDEX "coverageRule_org_subarea_dow_idx" ON "coverage_rule" USING btree ("organization_id","subarea_id","day_of_week");--> statement-breakpoint
CREATE INDEX "coverageSettings_organizationId_idx" ON "coverage_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "costCenter_organizationId_idx" ON "cost_center" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "costCenter_isActive_idx" ON "cost_center" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "costCenter_org_name_idx" ON "cost_center" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "costCenter_org_code_idx" ON "cost_center" USING btree ("organization_id","code") WHERE code IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employeeCostCenterAssignment_organizationId_idx" ON "employee_cost_center_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employeeCostCenterAssignment_employeeId_idx" ON "employee_cost_center_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeCostCenterAssignment_costCenterId_idx" ON "employee_cost_center_assignment" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "employeeCostCenterAssignment_effectiveFrom_idx" ON "employee_cost_center_assignment" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeCostCenterAssignment_active_employee_idx" ON "employee_cost_center_assignment" USING btree ("employee_id") WHERE effective_to IS NULL;--> statement-breakpoint
CREATE INDEX "idx_cron_job_execution_job_name_started_at" ON "cron_job_execution" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "idx_cron_job_execution_started_at" ON "cron_job_execution" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_cron_job_execution_bullmq_job_id" ON "cron_job_execution" USING btree ("bullmq_job_id");--> statement-breakpoint
CREATE INDEX "idx_cron_job_execution_status" ON "cron_job_execution" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customRole_organizationId_idx" ON "custom_role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customRole_isActive_idx" ON "custom_role" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "customRole_org_name_idx" ON "custom_role" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "customRoleAuditLog_organizationId_idx" ON "custom_role_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customRoleAuditLog_customRoleId_idx" ON "custom_role_audit_log" USING btree ("custom_role_id");--> statement-breakpoint
CREATE INDEX "customRoleAuditLog_eventType_idx" ON "custom_role_audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "customRoleAuditLog_createdAt_idx" ON "custom_role_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customRolePermission_customRoleId_idx" ON "custom_role_permission" USING btree ("custom_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customRolePermission_unique_idx" ON "custom_role_permission" USING btree ("custom_role_id","action","subject");--> statement-breakpoint
CREATE INDEX "employeeCustomRole_employeeId_idx" ON "employee_custom_role" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeCustomRole_customRoleId_idx" ON "employee_custom_role" USING btree ("custom_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeCustomRole_unique_idx" ON "employee_custom_role" USING btree ("employee_id","custom_role_id");--> statement-breakpoint
CREATE INDEX "customer_organizationId_idx" ON "customer" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customer_isActive_idx" ON "customer" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_org_name_idx" ON "customer" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "discordApprovalMessage_organizationId_idx" ON "discord_approval_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "discordApprovalMessage_approvalRequestId_idx" ON "discord_approval_message" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "discordApprovalMessage_recipientUserId_idx" ON "discord_approval_message" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "discordApprovalMessage_status_idx" ON "discord_approval_message" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "discordApprovalMessage_approvalRequest_recipient_unique_idx" ON "discord_approval_message" USING btree ("approval_request_id","recipient_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discordBotConfig_organizationId_unique_idx" ON "discord_bot_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "discordBotConfig_setupStatus_idx" ON "discord_bot_config" USING btree ("setup_status");--> statement-breakpoint
CREATE UNIQUE INDEX "discordBotConfig_webhookSecret_unique_idx" ON "discord_bot_config" USING btree ("webhook_secret");--> statement-breakpoint
CREATE INDEX "discordConversation_organizationId_idx" ON "discord_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "discordConversation_userId_idx" ON "discord_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "discordConversation_channelId_idx" ON "discord_conversation" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "discordConversation_isActive_idx" ON "discord_conversation" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "discordConversation_user_org_unique_idx" ON "discord_conversation" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "discordEscalation_organizationId_idx" ON "discord_escalation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "discordEscalation_approvalRequestId_idx" ON "discord_escalation" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "discordEscalation_originalApproverId_idx" ON "discord_escalation" USING btree ("original_approver_id");--> statement-breakpoint
CREATE INDEX "discordEscalation_escalatedToApproverId_idx" ON "discord_escalation" USING btree ("escalated_to_approver_id");--> statement-breakpoint
CREATE INDEX "discordEscalation_resolvedAt_idx" ON "discord_escalation" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discordLinkCode_code_unique_idx" ON "discord_link_code" USING btree ("code");--> statement-breakpoint
CREATE INDEX "discordLinkCode_userId_idx" ON "discord_link_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "discordLinkCode_organizationId_idx" ON "discord_link_code" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "discordLinkCode_status_idx" ON "discord_link_code" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discordLinkCode_expiresAt_idx" ON "discord_link_code" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "discordUserMapping_userId_idx" ON "discord_user_mapping" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "discordUserMapping_organizationId_idx" ON "discord_user_mapping" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "discordUserMapping_discordUserId_idx" ON "discord_user_mapping" USING btree ("discord_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discordUserMapping_user_org_unique_idx" ON "discord_user_mapping" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discordUserMapping_discord_org_unique_idx" ON "discord_user_mapping" USING btree ("discord_user_id","organization_id");--> statement-breakpoint
CREATE INDEX "organizationBranding_organizationId_idx" ON "organization_branding" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationDomain_organizationId_idx" ON "organization_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationDomain_domain_idx" ON "organization_domain" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organizationDomain_domainVerified_idx" ON "organization_domain" USING btree ("domain_verified");--> statement-breakpoint
CREATE UNIQUE INDEX "organizationDomain_org_single_idx" ON "organization_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationEmailConfig_organizationId_idx" ON "organization_email_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationEmailConfig_isActive_idx" ON "organization_email_config" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "organizationSocialOAuth_org_provider_idx" ON "organization_social_oauth" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "organizationSocialOAuth_organizationId_idx" ON "organization_social_oauth" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationSocialOAuth_isActive_idx" ON "organization_social_oauth" USING btree ("is_active");--> statement-breakpoint
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
CREATE INDEX "roleTemplate_organizationId_idx" ON "role_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "roleTemplate_isGlobal_idx" ON "role_template" USING btree ("is_global");--> statement-breakpoint
CREATE INDEX "roleTemplate_isActive_idx" ON "role_template" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "roleTemplate_org_name_idx" ON "role_template" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "roleTemplateMapping_organizationId_idx" ON "role_template_mapping" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "roleTemplateMapping_roleTemplateId_idx" ON "role_template_mapping" USING btree ("role_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roleTemplateMapping_unique_idx" ON "role_template_mapping" USING btree ("organization_id","idp_type","idp_group_id");--> statement-breakpoint
CREATE INDEX "userLifecycleConfig_organizationId_idx" ON "user_lifecycle_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "userLifecycleEvent_organizationId_idx" ON "user_lifecycle_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "userLifecycleEvent_userId_idx" ON "user_lifecycle_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "userLifecycleEvent_eventType_idx" ON "user_lifecycle_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "userLifecycleEvent_approvalStatus_idx" ON "user_lifecycle_event" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "userLifecycleEvent_createdAt_idx" ON "user_lifecycle_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "userRoleTemplateAssignment_user_org_idx" ON "user_role_template_assignment" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "userRoleTemplateAssignment_roleTemplateId_idx" ON "user_role_template_assignment" USING btree ("role_template_id");--> statement-breakpoint
CREATE INDEX "inviteCode_organizationId_idx" ON "invite_code" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "inviteCode_status_idx" ON "invite_code" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "inviteCode_org_code_idx" ON "invite_code" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "inviteCodeUsage_inviteCodeId_idx" ON "invite_code_usage" USING btree ("invite_code_id");--> statement-breakpoint
CREATE INDEX "inviteCodeUsage_userId_idx" ON "invite_code_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inviteCodeUsage_memberId_idx" ON "invite_code_usage" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memberApproval_memberId_idx" ON "member_approval" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memberApproval_organizationId_idx" ON "member_approval" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "memberApproval_status_idx" ON "member_approval" USING btree ("status");--> statement-breakpoint
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
CREATE INDEX "employee_userId_idx" ON "employee" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_organizationId_idx" ON "employee" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employee_teamId_idx" ON "employee" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "employee_managerId_idx" ON "employee" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employee_userId_isActive_idx" ON "employee" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "employeeManagers_employeeId_idx" ON "employee_managers" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeManagers_managerId_idx" ON "employee_managers" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employeeManagers_unique_idx" ON "employee_managers" USING btree ("employee_id","manager_id");--> statement-breakpoint
CREATE INDEX "employeeManagers_managerId_isPrimary_idx" ON "employee_managers" USING btree ("manager_id","is_primary");--> statement-breakpoint
CREATE INDEX "employeeRateHistory_employeeId_idx" ON "employee_rate_history" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeRateHistory_organizationId_idx" ON "employee_rate_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employeeRateHistory_employeeId_effectiveFrom_idx" ON "employee_rate_history" USING btree ("employee_id","effective_from");--> statement-breakpoint
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
CREATE UNIQUE INDEX "teamPermissions_unique_idx" ON "team_permissions" USING btree ("employee_id","organization_id","team_id");--> statement-breakpoint
CREATE INDEX "payrollExportConfig_organizationId_idx" ON "payroll_export_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payrollExportConfig_formatId_idx" ON "payroll_export_config" USING btree ("format_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrollExportConfig_org_format_active_idx" ON "payroll_export_config" USING btree ("organization_id","format_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "payrollExportFormat_isEnabled_idx" ON "payroll_export_format" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "payrollExportJob_organizationId_idx" ON "payroll_export_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payrollExportJob_configId_idx" ON "payroll_export_job" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "payrollExportJob_requestedById_idx" ON "payroll_export_job" USING btree ("requested_by_id");--> statement-breakpoint
CREATE INDEX "payrollExportJob_status_idx" ON "payroll_export_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payrollExportJob_createdAt_idx" ON "payroll_export_job" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payrollExportJob_status_isAsync_idx" ON "payroll_export_job" USING btree ("status","is_async");--> statement-breakpoint
CREATE INDEX "payrollExportSyncRecord_jobId_idx" ON "payroll_export_sync_record" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "payrollExportSyncRecord_status_idx" ON "payroll_export_sync_record" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payrollExportSyncRecord_sourceRecordId_idx" ON "payroll_export_sync_record" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "payrollExportSyncRecord_job_status_retryable_idx" ON "payroll_export_sync_record" USING btree ("job_id","status","is_retryable");--> statement-breakpoint
CREATE INDEX "payrollWageTypeMapping_configId_idx" ON "payroll_wage_type_mapping" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "payrollWageTypeMapping_workCategoryId_idx" ON "payroll_wage_type_mapping" USING btree ("work_category_id");--> statement-breakpoint
CREATE INDEX "payrollWageTypeMapping_absenceCategoryId_idx" ON "payroll_wage_type_mapping" USING btree ("absence_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrollWageTypeMapping_config_workCategory_idx" ON "payroll_wage_type_mapping" USING btree ("config_id","work_category_id") WHERE work_category_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "payrollWageTypeMapping_config_absenceCategory_idx" ON "payroll_wage_type_mapping" USING btree ("config_id","absence_category_id") WHERE absence_category_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "payrollWageTypeMapping_config_specialCategory_idx" ON "payroll_wage_type_mapping" USING btree ("config_id","special_category") WHERE special_category IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "organization_suspension_org_id_idx" ON "organization_suspension" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_suspension_is_active_idx" ON "organization_suspension" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_admin_user_id_idx" ON "platform_admin_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_action_idx" ON "platform_admin_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_target_type_idx" ON "platform_admin_audit_log" USING btree ("target_type");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_created_at_idx" ON "platform_admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "project_organizationId_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_status_idx" ON "project" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_deadline_idx" ON "project" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "project_isActive_idx" ON "project" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "project_customerId_idx" ON "project" USING btree ("customer_id");--> statement-breakpoint
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
CREATE INDEX "scheduledExport_organizationId_idx" ON "scheduled_export" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduledExport_isActive_idx" ON "scheduled_export" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "scheduledExport_nextExecutionAt_idx" ON "scheduled_export" USING btree ("next_execution_at");--> statement-breakpoint
CREATE INDEX "scheduledExport_reportType_idx" ON "scheduled_export" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "scheduledExport_active_nextExecution_idx" ON "scheduled_export" USING btree ("is_active","next_execution_at") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_scheduledExportId_idx" ON "scheduled_export_execution" USING btree ("scheduled_export_id");--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_organizationId_idx" ON "scheduled_export_execution" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_status_idx" ON "scheduled_export_execution" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_triggeredAt_idx" ON "scheduled_export_execution" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_schedule_triggered_idx" ON "scheduled_export_execution" USING btree ("scheduled_export_id","triggered_at");--> statement-breakpoint
CREATE INDEX "scimProviderConfig_organizationId_idx" ON "scim_provider_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scimProviderConfig_providerId_idx" ON "scim_provider_config" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "scimProvisioningLog_organizationId_idx" ON "scim_provisioning_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scimProvisioningLog_eventType_idx" ON "scim_provisioning_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "scimProvisioningLog_userId_idx" ON "scim_provisioning_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scimProvisioningLog_createdAt_idx" ON "scim_provisioning_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "shift_organizationId_idx" ON "shift" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shift_employeeId_idx" ON "shift" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "shift_templateId_idx" ON "shift" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "shift_subareaId_idx" ON "shift" USING btree ("subarea_id");--> statement-breakpoint
CREATE INDEX "shift_recurrenceId_idx" ON "shift" USING btree ("recurrence_id");--> statement-breakpoint
CREATE INDEX "shift_date_idx" ON "shift" USING btree ("date");--> statement-breakpoint
CREATE INDEX "shift_status_idx" ON "shift" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shift_org_date_status_idx" ON "shift" USING btree ("organization_id","date","status");--> statement-breakpoint
CREATE INDEX "shift_org_employee_date_idx" ON "shift" USING btree ("organization_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "shift_org_subarea_date_idx" ON "shift" USING btree ("organization_id","subarea_id","date");--> statement-breakpoint
CREATE INDEX "shiftRecurrence_organizationId_idx" ON "shift_recurrence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shiftRecurrence_templateId_idx" ON "shift_recurrence" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "shiftRecurrence_subareaId_idx" ON "shift_recurrence" USING btree ("subarea_id");--> statement-breakpoint
CREATE INDEX "shiftRecurrence_isActive_idx" ON "shift_recurrence" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "shiftRecurrence_org_active_idx" ON "shift_recurrence" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "shiftRequest_shiftId_idx" ON "shift_request" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_requesterId_idx" ON "shift_request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_targetEmployeeId_idx" ON "shift_request" USING btree ("target_employee_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_approverId_idx" ON "shift_request" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "shiftRequest_status_idx" ON "shift_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shiftRequest_type_status_idx" ON "shift_request" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "shiftTemplate_organizationId_idx" ON "shift_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shiftTemplate_subareaId_idx" ON "shift_template" USING btree ("subarea_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shiftTemplate_org_name_idx" ON "shift_template" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "employeeSkill_employeeId_idx" ON "employee_skill" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeSkill_skillId_idx" ON "employee_skill" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "employeeSkill_expiresAt_idx" ON "employee_skill" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeSkill_unique_idx" ON "employee_skill" USING btree ("employee_id","skill_id");--> statement-breakpoint
CREATE INDEX "shiftTemplateSkillReq_templateId_idx" ON "shift_template_skill_requirement" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "shiftTemplateSkillReq_skillId_idx" ON "shift_template_skill_requirement" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shiftTemplateSkillReq_unique_idx" ON "shift_template_skill_requirement" USING btree ("template_id","skill_id");--> statement-breakpoint
CREATE INDEX "skill_organizationId_idx" ON "skill" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skill_category_idx" ON "skill" USING btree ("category");--> statement-breakpoint
CREATE INDEX "skill_isActive_idx" ON "skill" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_org_name_idx" ON "skill" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "skillOverride_organizationId_idx" ON "skill_requirement_override" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skillOverride_shiftId_idx" ON "skill_requirement_override" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "skillOverride_employeeId_idx" ON "skill_requirement_override" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "skillOverride_overriddenBy_idx" ON "skill_requirement_override" USING btree ("overridden_by");--> statement-breakpoint
CREATE INDEX "subareaSkillReq_subareaId_idx" ON "subarea_skill_requirement" USING btree ("subarea_id");--> statement-breakpoint
CREATE INDEX "subareaSkillReq_skillId_idx" ON "subarea_skill_requirement" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subareaSkillReq_unique_idx" ON "subarea_skill_requirement" USING btree ("subarea_id","skill_id");--> statement-breakpoint
CREATE INDEX "slackApprovalMessage_organizationId_idx" ON "slack_approval_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slackApprovalMessage_approvalRequestId_idx" ON "slack_approval_message" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "slackApprovalMessage_recipientUserId_idx" ON "slack_approval_message" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "slackApprovalMessage_status_idx" ON "slack_approval_message" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "slackApprovalMessage_approvalRequest_unique_idx" ON "slack_approval_message" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "slackConversation_organizationId_idx" ON "slack_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slackConversation_userId_idx" ON "slack_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slackConversation_channelId_idx" ON "slack_conversation" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "slackConversation_isActive_idx" ON "slack_conversation" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "slackConversation_user_org_type_unique_idx" ON "slack_conversation" USING btree ("user_id","organization_id","channel_type");--> statement-breakpoint
CREATE INDEX "slackEscalation_organizationId_idx" ON "slack_escalation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slackEscalation_approvalRequestId_idx" ON "slack_escalation" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "slackEscalation_originalApproverId_idx" ON "slack_escalation" USING btree ("original_approver_id");--> statement-breakpoint
CREATE INDEX "slackEscalation_escalatedToApproverId_idx" ON "slack_escalation" USING btree ("escalated_to_approver_id");--> statement-breakpoint
CREATE INDEX "slackEscalation_resolvedAt_idx" ON "slack_escalation" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slackLinkCode_code_unique_idx" ON "slack_link_code" USING btree ("code");--> statement-breakpoint
CREATE INDEX "slackLinkCode_userId_idx" ON "slack_link_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slackLinkCode_organizationId_idx" ON "slack_link_code" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slackLinkCode_status_idx" ON "slack_link_code" USING btree ("status");--> statement-breakpoint
CREATE INDEX "slackLinkCode_expiresAt_idx" ON "slack_link_code" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slackOAuthState_stateToken_unique_idx" ON "slack_oauth_state" USING btree ("state_token");--> statement-breakpoint
CREATE INDEX "slackOAuthState_organizationId_idx" ON "slack_oauth_state" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slackOAuthState_status_idx" ON "slack_oauth_state" USING btree ("status");--> statement-breakpoint
CREATE INDEX "slackOAuthState_expiresAt_idx" ON "slack_oauth_state" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "slackUserMapping_userId_idx" ON "slack_user_mapping" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slackUserMapping_organizationId_idx" ON "slack_user_mapping" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slackUserMapping_slackUserId_idx" ON "slack_user_mapping" USING btree ("slack_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slackUserMapping_user_org_unique_idx" ON "slack_user_mapping" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slackUserMapping_slack_team_unique_idx" ON "slack_user_mapping" USING btree ("slack_user_id","slack_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slackWorkspaceConfig_organizationId_unique_idx" ON "slack_workspace_config" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slackWorkspaceConfig_slackTeamId_unique_idx" ON "slack_workspace_config" USING btree ("slack_team_id");--> statement-breakpoint
CREATE INDEX "slackWorkspaceConfig_setupStatus_idx" ON "slack_workspace_config" USING btree ("setup_status");--> statement-breakpoint
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
CREATE INDEX "teamsApprovalCard_organizationId_idx" ON "teams_approval_card" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamsApprovalCard_approvalRequestId_idx" ON "teams_approval_card" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "teamsApprovalCard_recipientUserId_idx" ON "teams_approval_card" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "teamsApprovalCard_status_idx" ON "teams_approval_card" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "teamsApprovalCard_approvalRequest_unique_idx" ON "teams_approval_card" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "teamsConversation_organizationId_idx" ON "teams_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamsConversation_userId_idx" ON "teams_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teamsConversation_teamsConversationId_idx" ON "teams_conversation" USING btree ("teams_conversation_id");--> statement-breakpoint
CREATE INDEX "teamsConversation_teamsTenantId_idx" ON "teams_conversation" USING btree ("teams_tenant_id");--> statement-breakpoint
CREATE INDEX "teamsConversation_isActive_idx" ON "teams_conversation" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "teamsConversation_user_org_type_unique_idx" ON "teams_conversation" USING btree ("user_id","organization_id","conversation_type");--> statement-breakpoint
CREATE INDEX "teamsEscalation_organizationId_idx" ON "teams_escalation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamsEscalation_approvalRequestId_idx" ON "teams_escalation" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "teamsEscalation_originalApproverId_idx" ON "teams_escalation" USING btree ("original_approver_id");--> statement-breakpoint
CREATE INDEX "teamsEscalation_escalatedToApproverId_idx" ON "teams_escalation" USING btree ("escalated_to_approver_id");--> statement-breakpoint
CREATE INDEX "teamsEscalation_resolvedAt_idx" ON "teams_escalation" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "teamsTenantConfig_organizationId_idx" ON "teams_tenant_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamsTenantConfig_tenantId_idx" ON "teams_tenant_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "teamsTenantConfig_setupStatus_idx" ON "teams_tenant_config" USING btree ("setup_status");--> statement-breakpoint
CREATE UNIQUE INDEX "teamsTenantConfig_tenantId_unique_idx" ON "teams_tenant_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "teamsUserMapping_userId_idx" ON "teams_user_mapping" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teamsUserMapping_organizationId_idx" ON "teams_user_mapping" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teamsUserMapping_teamsUserId_idx" ON "teams_user_mapping" USING btree ("teams_user_id");--> statement-breakpoint
CREATE INDEX "teamsUserMapping_teamsEmail_idx" ON "teams_user_mapping" USING btree ("teams_email");--> statement-breakpoint
CREATE INDEX "teamsUserMapping_teamsTenantId_idx" ON "teams_user_mapping" USING btree ("teams_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teamsUserMapping_user_org_unique_idx" ON "teams_user_mapping" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teamsUserMapping_teams_tenant_unique_idx" ON "teams_user_mapping" USING btree ("teams_user_id","teams_tenant_id");--> statement-breakpoint
CREATE INDEX "telegramApprovalMessage_organizationId_idx" ON "telegram_approval_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegramApprovalMessage_approvalRequestId_idx" ON "telegram_approval_message" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "telegramApprovalMessage_recipientUserId_idx" ON "telegram_approval_message" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "telegramApprovalMessage_status_idx" ON "telegram_approval_message" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramApprovalMessage_approvalRequest_unique_idx" ON "telegram_approval_message" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramBotConfig_organizationId_unique_idx" ON "telegram_bot_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegramBotConfig_setupStatus_idx" ON "telegram_bot_config" USING btree ("setup_status");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramBotConfig_webhookSecret_unique_idx" ON "telegram_bot_config" USING btree ("webhook_secret");--> statement-breakpoint
CREATE INDEX "telegramConversation_organizationId_idx" ON "telegram_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegramConversation_userId_idx" ON "telegram_conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegramConversation_chatId_idx" ON "telegram_conversation" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "telegramConversation_isActive_idx" ON "telegram_conversation" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramConversation_user_org_type_unique_idx" ON "telegram_conversation" USING btree ("user_id","organization_id","chat_type");--> statement-breakpoint
CREATE INDEX "telegramEscalation_organizationId_idx" ON "telegram_escalation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegramEscalation_approvalRequestId_idx" ON "telegram_escalation" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "telegramEscalation_originalApproverId_idx" ON "telegram_escalation" USING btree ("original_approver_id");--> statement-breakpoint
CREATE INDEX "telegramEscalation_escalatedToApproverId_idx" ON "telegram_escalation" USING btree ("escalated_to_approver_id");--> statement-breakpoint
CREATE INDEX "telegramEscalation_resolvedAt_idx" ON "telegram_escalation" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramLinkCode_code_unique_idx" ON "telegram_link_code" USING btree ("code");--> statement-breakpoint
CREATE INDEX "telegramLinkCode_userId_idx" ON "telegram_link_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegramLinkCode_organizationId_idx" ON "telegram_link_code" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegramLinkCode_status_idx" ON "telegram_link_code" USING btree ("status");--> statement-breakpoint
CREATE INDEX "telegramLinkCode_expiresAt_idx" ON "telegram_link_code" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "telegramUserMapping_userId_idx" ON "telegram_user_mapping" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegramUserMapping_organizationId_idx" ON "telegram_user_mapping" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegramUserMapping_telegramUserId_idx" ON "telegram_user_mapping" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramUserMapping_user_org_unique_idx" ON "telegram_user_mapping" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegramUserMapping_telegram_org_unique_idx" ON "telegram_user_mapping" USING btree ("telegram_user_id","organization_id");--> statement-breakpoint
CREATE INDEX "timeEntry_employeeId_idx" ON "time_entry" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "timeEntry_organizationId_idx" ON "time_entry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeEntry_timestamp_idx" ON "time_entry" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "timeEntry_previousEntryId_idx" ON "time_entry" USING btree ("previous_entry_id");--> statement-breakpoint
CREATE INDEX "timeEntry_replacesEntryId_idx" ON "time_entry" USING btree ("replaces_entry_id");--> statement-breakpoint
CREATE INDEX "timeEntry_emp_org_timestamp_idx" ON "time_entry" USING btree ("employee_id","organization_id","timestamp");--> statement-breakpoint
CREATE INDEX "timeEntry_emp_org_isSuperseded_timestamp_idx" ON "time_entry" USING btree ("employee_id","organization_id","is_superseded","timestamp");--> statement-breakpoint
CREATE INDEX "workPeriod_employeeId_idx" ON "work_period" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "workPeriod_organizationId_idx" ON "work_period" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workPeriod_startTime_idx" ON "work_period" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "workPeriod_projectId_idx" ON "work_period" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workPeriod_workCategoryId_idx" ON "work_period" USING btree ("work_category_id");--> statement-breakpoint
CREATE INDEX "workPeriod_approvalStatus_idx" ON "work_period" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "workPeriod_org_startTime_idx" ON "work_period" USING btree ("organization_id","start_time");--> statement-breakpoint
CREATE INDEX "workPeriod_emp_org_startTime_idx" ON "work_period" USING btree ("employee_id","organization_id","start_time");--> statement-breakpoint
CREATE INDEX "userSettings_userId_idx" ON "user_settings" USING btree ("user_id");--> statement-breakpoint
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
CREATE INDEX "webhook_delivery_endpoint_idx" ON "webhook_delivery" USING btree ("webhook_endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_organization_idx" ON "webhook_delivery" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_idx" ON "webhook_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_delivery_event_type_idx" ON "webhook_delivery" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "webhook_delivery_created_at_idx" ON "webhook_delivery" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_next_retry_idx" ON "webhook_delivery" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_endpoint_created_idx" ON "webhook_delivery" USING btree ("webhook_endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_idx" ON "webhook_endpoint" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_is_active_idx" ON "webhook_endpoint" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_active_idx" ON "webhook_endpoint" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "hydration_stats_userId_idx" ON "hydration_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "water_intake_log_userId_idx" ON "water_intake_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "water_intake_log_loggedAt_idx" ON "water_intake_log" USING btree ("logged_at");--> statement-breakpoint
CREATE INDEX "workCategory_organizationId_idx" ON "work_category" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workCategory_org_name_idx" ON "work_category" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "workCategorySet_organizationId_idx" ON "work_category_set" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workCategorySet_org_name_idx" ON "work_category_set" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "workCategorySetAssignment_setId_idx" ON "work_category_set_assignment" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "workCategorySetAssignment_organizationId_idx" ON "work_category_set_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workCategorySetAssignment_teamId_idx" ON "work_category_set_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "workCategorySetAssignment_employeeId_idx" ON "work_category_set_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workCategorySetAssignment_org_default_idx" ON "work_category_set_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workCategorySetAssignment_team_idx" ON "work_category_set_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workCategorySetAssignment_employee_idx" ON "work_category_set_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "workCategorySetCategory_setId_idx" ON "work_category_set_category" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "workCategorySetCategory_categoryId_idx" ON "work_category_set_category" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workCategorySetCategory_set_category_idx" ON "work_category_set_category" USING btree ("set_id","category_id");--> statement-breakpoint
CREATE INDEX "workPolicy_organizationId_idx" ON "work_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workPolicy_isActive_idx" ON "work_policy" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicy_org_name_idx" ON "work_policy" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_policyId_idx" ON "work_policy_assignment" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_organizationId_idx" ON "work_policy_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_teamId_idx" ON "work_policy_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_employeeId_idx" ON "work_policy_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyAssignment_org_default_idx" ON "work_policy_assignment" USING btree ("organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyAssignment_team_idx" ON "work_policy_assignment" USING btree ("team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyAssignment_employee_idx" ON "work_policy_assignment" USING btree ("employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "workPolicyBreakOption_breakRuleId_idx" ON "work_policy_break_option" USING btree ("break_rule_id");--> statement-breakpoint
CREATE INDEX "workPolicyBreakRule_regulationId_idx" ON "work_policy_break_rule" USING btree ("regulation_id");--> statement-breakpoint
CREATE INDEX "workPolicyBreakRule_sortOrder_idx" ON "work_policy_break_rule" USING btree ("regulation_id","sort_order");--> statement-breakpoint
CREATE INDEX "workPolicyPresence_policyId_idx" ON "work_policy_presence" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "workPolicyPresence_locationId_idx" ON "work_policy_presence" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "workPolicyPreset_countryCode_idx" ON "work_policy_preset" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "workPolicyPreset_isActive_idx" ON "work_policy_preset" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "workPolicyRegulation_policyId_idx" ON "work_policy_regulation" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "workPolicySchedule_policyId_idx" ON "work_policy_schedule" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "workPolicyScheduleDay_scheduleId_idx" ON "work_policy_schedule_day" USING btree ("schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyScheduleDay_unique_idx" ON "work_policy_schedule_day" USING btree ("schedule_id","day_of_week","cycle_week");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_employeeId_idx" ON "work_policy_violation" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_organizationId_idx" ON "work_policy_violation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_policyId_idx" ON "work_policy_violation" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_violationDate_idx" ON "work_policy_violation" USING btree ("violation_date");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_violationType_idx" ON "work_policy_violation" USING btree ("violation_type");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_org_date_idx" ON "work_policy_violation" USING btree ("organization_id","violation_date");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_emp_date_idx" ON "work_policy_violation" USING btree ("employee_id","violation_date");