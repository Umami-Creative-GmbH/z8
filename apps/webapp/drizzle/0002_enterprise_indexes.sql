-- Enterprise Performance Indexes
-- These indexes support scaling to 5,000-7,000 employees with optimized query performance

-- Time entry indexes for fast lookups and reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_time_entry_employee_timestamp"
ON "time_entry" ("employee_id", "timestamp" DESC);--> statement-breakpoint

-- Work period indexes for employee work history queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_work_period_employee_start"
ON "work_period" ("employee_id", "start_time" DESC);--> statement-breakpoint

-- Covering index for work period aggregations (includes frequently accessed columns)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_work_period_covering"
ON "work_period" ("employee_id", "start_time") INCLUDE ("duration_minutes");--> statement-breakpoint

-- Absence entry indexes for date range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_absence_entry_employee_dates"
ON "absence_entry" ("employee_id", "start_date", "end_date");--> statement-breakpoint

-- Partial index for active employees only (most common query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_employee_org_active"
ON "employee" ("organization_id") WHERE "is_active" = true;--> statement-breakpoint

-- Notification indexes for real-time notification queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notification_user_unread"
ON "notification" ("user_id", "organization_id") WHERE "is_read" = false;--> statement-breakpoint

-- Notification index for fetching by user with ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notification_user_created"
ON "notification" ("user_id", "created_at" DESC);--> statement-breakpoint

-- Audit log index for entity lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_log_entity"
ON "audit_log" ("entity_type", "entity_id");--> statement-breakpoint

-- Audit log index for timestamp-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_log_timestamp"
ON "audit_log" ("timestamp" DESC);--> statement-breakpoint

-- Shift indexes for schedule views
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_shift_employee_date"
ON "shift" ("employee_id", "date");--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_shift_org_date"
ON "shift" ("organization_id", "date");
