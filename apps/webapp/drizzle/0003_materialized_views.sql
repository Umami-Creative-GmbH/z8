-- Materialized Views for Heavy Analytics
-- These pre-aggregated views dramatically improve report generation performance
-- for organizations with 5,000-7,000 employees

-- Monthly work hours aggregation per employee
-- Used for: Monthly reports, payroll calculations, overtime analysis
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_employee_work_hours_monthly AS
SELECT
  wp.employee_id,
  e.organization_id,
  date_trunc('month', wp.start_time) AS month,
  SUM(wp.duration_minutes) AS total_minutes,
  COUNT(DISTINCT DATE(wp.start_time)) AS work_days,
  SUM(wp.break_duration_minutes) AS total_break_minutes,
  COUNT(*) AS work_period_count
FROM work_period wp
JOIN employee e ON e.id = wp.employee_id
WHERE wp.is_active = false  -- Only completed work periods
GROUP BY wp.employee_id, e.organization_id, date_trunc('month', wp.start_time);--> statement-breakpoint

-- Index for efficient queries on the materialized view
CREATE INDEX IF NOT EXISTS idx_mv_work_hours_employee_month
ON mv_employee_work_hours_monthly(employee_id, month DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_work_hours_org_month
ON mv_employee_work_hours_monthly(organization_id, month DESC);--> statement-breakpoint

-- Daily work hours aggregation per employee
-- Used for: Daily dashboards, real-time tracking summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_employee_work_hours_daily AS
SELECT
  wp.employee_id,
  e.organization_id,
  DATE(wp.start_time) AS work_date,
  SUM(wp.duration_minutes) AS total_minutes,
  SUM(wp.break_duration_minutes) AS total_break_minutes,
  MIN(wp.start_time) AS first_clock_in,
  MAX(wp.end_time) AS last_clock_out,
  COUNT(*) AS work_period_count
FROM work_period wp
JOIN employee e ON e.id = wp.employee_id
WHERE wp.is_active = false
GROUP BY wp.employee_id, e.organization_id, DATE(wp.start_time);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_work_hours_daily_employee_date
ON mv_employee_work_hours_daily(employee_id, work_date DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_work_hours_daily_org_date
ON mv_employee_work_hours_daily(organization_id, work_date DESC);--> statement-breakpoint

-- Absence summary per employee per year
-- Used for: Vacation balance calculations, absence reports
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_employee_absence_yearly AS
SELECT
  ae.employee_id,
  e.organization_id,
  EXTRACT(YEAR FROM ae.start_date) AS year,
  ac.name AS category_name,
  ac.id AS category_id,
  COUNT(*) AS absence_count,
  SUM(
    CASE
      WHEN ae.end_date IS NULL THEN 1
      ELSE (ae.end_date - ae.start_date + 1)
    END
  ) AS total_days
FROM absence_entry ae
JOIN employee e ON e.id = ae.employee_id
LEFT JOIN absence_category ac ON ac.id = ae.category_id
WHERE ae.status = 'approved'
GROUP BY ae.employee_id, e.organization_id, EXTRACT(YEAR FROM ae.start_date), ac.id, ac.name;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_absence_yearly_employee_year
ON mv_employee_absence_yearly(employee_id, year DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_absence_yearly_org_year
ON mv_employee_absence_yearly(organization_id, year DESC);--> statement-breakpoint

-- Team work hours summary (for manager dashboards)
-- Used for: Team reports, department summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_team_work_hours_monthly AS
SELECT
  e.primary_team_id AS team_id,
  e.organization_id,
  date_trunc('month', wp.start_time) AS month,
  COUNT(DISTINCT wp.employee_id) AS active_employees,
  SUM(wp.duration_minutes) AS total_minutes,
  AVG(wp.duration_minutes) AS avg_minutes_per_period,
  COUNT(*) AS work_period_count
FROM work_period wp
JOIN employee e ON e.id = wp.employee_id
WHERE wp.is_active = false
  AND e.primary_team_id IS NOT NULL
GROUP BY e.primary_team_id, e.organization_id, date_trunc('month', wp.start_time);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_team_work_hours_team_month
ON mv_team_work_hours_monthly(team_id, month DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_team_work_hours_org_month
ON mv_team_work_hours_monthly(organization_id, month DESC);
