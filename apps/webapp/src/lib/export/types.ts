/**
 * Export types and constants
 * This file is safe to import from client components
 */

export type ExportCategory =
	| "employees"
	| "teams"
	| "time_entries"
	| "work_periods"
	| "absences"
	| "holidays"
	| "vacation"
	| "schedules"
	| "shifts"
	| "audit_logs";

export const EXPORT_CATEGORIES: ExportCategory[] = [
	"employees",
	"teams",
	"time_entries",
	"work_periods",
	"absences",
	"holidays",
	"vacation",
	"schedules",
	"shifts",
	"audit_logs",
];

export const CATEGORY_LABELS: Record<ExportCategory, string> = {
	employees: "Employees",
	teams: "Teams",
	time_entries: "Time Tracking",
	work_periods: "Work Periods",
	absences: "Absences",
	holidays: "Holidays",
	vacation: "Vacation Policies",
	schedules: "Work Schedules",
	shifts: "Shifts",
	audit_logs: "Audit Logs",
};
