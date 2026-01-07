-- Analytics Performance Indexes
-- Migration: 001_add_analytics_indexes
-- Created: 2026-01-07
-- Purpose: Add indexes to optimize analytics queries for team performance,
--          vacation trends, work hours analysis, and dashboard widgets

-- ============================================================================
-- Work Period Indexes
-- ============================================================================

-- Index for work period queries by date range (used in work hours analytics)
-- Covers: AnalyticsService.getWorkHoursAnalytics, QuickStatsWidget
CREATE INDEX IF NOT EXISTS idx_work_period_date_range
ON work_period(employee_id, start_time, end_time, is_active)
WHERE is_active = false;

-- Index for employee work period queries with organization filter
CREATE INDEX IF NOT EXISTS idx_work_period_employee_org
ON work_period(employee_id, organization_id, start_time)
WHERE is_active = false;

-- ============================================================================
-- Absence Entry Indexes
-- ============================================================================

-- Index for absence queries by date range and status (used in vacation analytics)
-- Covers: AnalyticsService.getVacationTrends, getAbsencePatterns
CREATE INDEX IF NOT EXISTS idx_absence_date_range_status
ON absence_entry(organization_id, status, start_date, end_date);

-- Index for upcoming absences (used in dashboard widget)
-- Covers: UpcomingTimeOffWidget, TeamCalendarWidget
CREATE INDEX IF NOT EXISTS idx_absence_upcoming
ON absence_entry(organization_id, status, start_date)
WHERE status = 'approved';

-- Index for absence category analytics
CREATE INDEX IF NOT EXISTS idx_absence_category_org
ON absence_entry(organization_id, category_id, status, start_date);

-- ============================================================================
-- Approval Request Indexes
-- ============================================================================

-- Index for approval queries by status and date (used in manager effectiveness)
-- Covers: AnalyticsService.getManagerEffectiveness, RecentlyApprovedWidget
CREATE INDEX IF NOT EXISTS idx_approval_status_date
ON approval_request(organization_id, status, updated_at);

-- Index for approver queries
CREATE INDEX IF NOT EXISTS idx_approval_approver
ON approval_request(approver_id, status, updated_at);

-- Index for requester queries
CREATE INDEX IF NOT EXISTS idx_approval_requester
ON approval_request(requested_by_id, status, created_at);

-- ============================================================================
-- Employee Indexes
-- ============================================================================

-- Index for team queries with active status (used in team performance)
-- Covers: AnalyticsService.getTeamPerformance
CREATE INDEX IF NOT EXISTS idx_employee_team_active
ON employee(team_id, is_active, organization_id)
WHERE is_active = true;

-- Index for birthday queries (used in birthday widget)
-- Covers: BirthdayRemindersWidget
CREATE INDEX IF NOT EXISTS idx_employee_birthday
ON employee(organization_id, birthday)
WHERE birthday IS NOT NULL AND is_active = true;

-- Index for manager queries
CREATE INDEX IF NOT EXISTS idx_employee_manager
ON employee(manager_id, organization_id, is_active)
WHERE is_active = true;

-- ============================================================================
-- Employee Work Schedule Indexes
-- ============================================================================

-- Index for work schedule lookups with effective dates
CREATE INDEX IF NOT EXISTS idx_work_schedule_employee_effective
ON employee_work_schedule(employee_id, effective_from, effective_until);

-- Index for active schedules
CREATE INDEX IF NOT EXISTS idx_work_schedule_active
ON employee_work_schedule(employee_id, effective_from)
WHERE effective_until IS NULL;

-- ============================================================================
-- Team Indexes
-- ============================================================================

-- Index for team organization queries
CREATE INDEX IF NOT EXISTS idx_team_organization
ON team(organization_id, created_at);

-- ============================================================================
-- Vacation Allowance Indexes
-- ============================================================================

-- Index for vacation allowance queries by employee and year
CREATE INDEX IF NOT EXISTS idx_vacation_allowance_employee_year
ON vacation_allowance(employee_id, year);

-- Index for organization vacation queries
CREATE INDEX IF NOT EXISTS idx_vacation_allowance_org_year
ON vacation_allowance(organization_id, year);

-- ============================================================================
-- Composite Indexes for Complex Queries
-- ============================================================================

-- Work period analytics composite (employee + time range + organization)
CREATE INDEX IF NOT EXISTS idx_work_period_analytics
ON work_period(organization_id, employee_id, start_time, end_time, is_active)
WHERE is_active = false;

-- Absence analytics composite (organization + category + status + dates)
CREATE INDEX IF NOT EXISTS idx_absence_analytics
ON absence_entry(organization_id, category_id, status, start_date, end_date);

-- Approval analytics composite (organization + status + approver + date)
CREATE INDEX IF NOT EXISTS idx_approval_analytics
ON approval_request(organization_id, status, approver_id, updated_at);

-- ============================================================================
-- Index Statistics and Recommendations
-- ============================================================================

-- After creating these indexes, run:
-- ANALYZE work_period;
-- ANALYZE absence_entry;
-- ANALYZE approval_request;
-- ANALYZE employee;
-- ANALYZE employee_work_schedule;

-- Monitor index usage with:
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
-- ORDER BY idx_scan DESC;

-- Check for unused indexes periodically:
-- SELECT schemaname, tablename, indexname
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0 AND schemaname NOT IN ('pg_catalog', 'information_schema');
