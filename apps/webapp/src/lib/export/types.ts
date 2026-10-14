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

/** Each category's name: its English default and its key in the export emails' catalog. */
export const CATEGORY_LABELS: Record<ExportCategory, { labelKey: string; label: string }> = {
	employees: { labelKey: "emails.export.categories.employees", label: "Employees" },
	teams: { labelKey: "emails.export.categories.teams", label: "Teams" },
	time_entries: { labelKey: "emails.export.categories.timeEntries", label: "Time Tracking" },
	work_periods: { labelKey: "emails.export.categories.workPeriods", label: "Work Periods" },
	absences: { labelKey: "emails.export.categories.absences", label: "Absences" },
	balance_adjustments: {
		labelKey: "emails.export.categories.balanceAdjustments",
		label: "Work Balance Adjustments",
	},
	holidays: { labelKey: "emails.export.categories.holidays", label: "Holidays" },
	vacation: { labelKey: "emails.export.categories.vacation", label: "Vacation Policies" },
	schedules: { labelKey: "emails.export.categories.schedules", label: "Work Schedules" },
	shifts: { labelKey: "emails.export.categories.shifts", label: "Shifts" },
	audit_logs: { labelKey: "emails.export.categories.auditLogs", label: "Audit Logs" },
	projects: { labelKey: "emails.export.categories.projects", label: "Projects" },
	customers: { labelKey: "emails.export.categories.customers", label: "Customers" },
};

export function isExportCategory(value: string): value is ExportCategory {
	return Object.hasOwn(CATEGORY_LABELS, value);
}
