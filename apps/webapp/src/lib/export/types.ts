/**
 * Export types and constants
 * This file is safe to import from client components
 */

/**
 * Locale-free settings route that opens Data Export on the Export History tab
 * of one organization. The organization sits in the path, not the query,
 * because the sign-in redirect keeps only the path of the requested page.
 */
export function exportHistoryPath(organizationId: string): string {
	return `/settings/export/history/${encodeURIComponent(organizationId)}`;
}

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
	| "audit_logs"
	| "projects"
	| "customers";

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
	"projects",
	"customers",
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
	projects: "Projects",
	customers: "Customers",
};
