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
	| "balance_adjustments"
	| "holidays"
	| "vacation"
	| "schedules"
	| "shifts"
	| "audit_logs"
	| "projects"
	| "customers";

export const EXPORT_CATEGORIES: ExportCategory[] = [
	"employees",
	"teams",
	"time_entries",
	"work_periods",
	"absences",
	"balance_adjustments",
	"holidays",
	"vacation",
	"schedules",
	"shifts",
	"audit_logs",
	"projects",
	"customers",
];

export const CATEGORY_LABELS: Record<ExportCategory, string> = {
	employees: "Employees",
	teams: "Teams",
	time_entries: "Time Tracking",
	work_periods: "Work Periods",
	absences: "Absences",
	balance_adjustments: "Work Balance Adjustments",
	holidays: "Holidays",
	vacation: "Vacation Policies",
	schedules: "Work Schedules",
	shifts: "Shifts",
	audit_logs: "Audit Logs",
	projects: "Projects",
	customers: "Customers",
};
