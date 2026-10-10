import type { ExportCategory } from "@/lib/export/types";

/**
 * The label and description of each data export category, as static Tolgee
 * keys with English defaults (the extractor reads `labelKey`/`label` and
 * `descriptionKey`/`description` siblings).
 */
export const EXPORT_CATEGORY_COPY: Record<
	ExportCategory,
	{ labelKey: string; label: string; descriptionKey: string; description: string }
> = {
	employees: {
		labelKey: "settings.dataExport.categories.employees.label",
		label: "Employees",
		descriptionKey: "settings.dataExport.categories.employees.description",
		description: "Employee profiles, manager relationships and employee custom fields",
	},
	teams: {
		labelKey: "settings.dataExport.categories.teams.label",
		label: "Teams",
		descriptionKey: "settings.dataExport.categories.teams.description",
		description: "Team structure and permissions",
	},
	time_entries: {
		labelKey: "settings.dataExport.categories.time_entries.label",
		label: "Time Tracking",
		descriptionKey: "settings.dataExport.categories.time_entries.description",
		description: "Time clock entries and corrections",
	},
	work_periods: {
		labelKey: "settings.dataExport.categories.work_periods.label",
		label: "Work Periods",
		descriptionKey: "settings.dataExport.categories.work_periods.description",
		description: "Aggregated work sessions",
	},
	absences: {
		labelKey: "settings.dataExport.categories.absences.label",
		label: "Absences",
		descriptionKey: "settings.dataExport.categories.absences.description",
		description: "Absence records and categories",
	},
	holidays: {
		labelKey: "settings.dataExport.categories.holidays.label",
		label: "Holidays",
		descriptionKey: "settings.dataExport.categories.holidays.description",
		description: "Holiday calendar and presets",
	},
	vacation: {
		labelKey: "settings.dataExport.categories.vacation.label",
		label: "Vacation Policies",
		descriptionKey: "settings.dataExport.categories.vacation.description",
		description: "Vacation policies and allowances",
	},
	schedules: {
		labelKey: "settings.dataExport.categories.schedules.label",
		label: "Work Schedules",
		descriptionKey: "settings.dataExport.categories.schedules.description",
		description: "Work schedule templates and assignments",
	},
	shifts: {
		labelKey: "settings.dataExport.categories.shifts.label",
		label: "Shifts",
		descriptionKey: "settings.dataExport.categories.shifts.description",
		description: "Shift scheduling data",
	},
	audit_logs: {
		labelKey: "settings.dataExport.categories.audit_logs.label",
		label: "Audit Logs",
		descriptionKey: "settings.dataExport.categories.audit_logs.description",
		description: "Activity audit trail",
	},
	projects: {
		labelKey: "settings.dataExport.categories.projects.label",
		label: "Projects",
		descriptionKey: "settings.dataExport.categories.projects.description",
		description: "Projects with their customer and project custom fields",
	},
	customers: {
		labelKey: "settings.dataExport.categories.customers.label",
		label: "Customers",
		descriptionKey: "settings.dataExport.categories.customers.description",
		description: "Customers with their customer custom fields",
	},
};
