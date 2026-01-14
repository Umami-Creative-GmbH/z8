export type SettingsGroup = "account" | "organization" | "administration" | "enterprise" | "data";

export type FeatureFlag = "shiftsEnabled" | "projectsEnabled" | "surchargesEnabled";

export type SettingsIconName =
	| "user-circle"
	| "shield"
	| "bell"
	| "building"
	| "users"
	| "map-pin"
	| "calendar-event"
	| "beach"
	| "clock"
	| "gavel"
	| "percentage"
	| "briefcase"
	| "world"
	| "history"
	| "chart-bar"
	| "database-export"
	| "test-pipe";

export interface SettingsEntry {
	id: string;
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	href: string;
	icon: SettingsIconName;
	adminOnly: boolean;
	group: SettingsGroup;
	/** Feature flag that must be enabled for this setting to be accessible */
	requiredFeature?: FeatureFlag;
}

export interface SettingsGroupConfig {
	id: SettingsGroup;
	labelKey: string;
	labelDefault: string;
	adminOnly: boolean;
}

export const SETTINGS_GROUPS: SettingsGroupConfig[] = [
	{
		id: "account",
		labelKey: "settings.group.account",
		labelDefault: "Account",
		adminOnly: false,
	},
	{
		id: "organization",
		labelKey: "settings.group.organization",
		labelDefault: "Organization",
		adminOnly: false,
	},
	{
		id: "administration",
		labelKey: "settings.group.administration",
		labelDefault: "Administration",
		adminOnly: true,
	},
	{
		id: "enterprise",
		labelKey: "settings.group.enterprise",
		labelDefault: "Enterprise",
		adminOnly: true,
	},
	{
		id: "data",
		labelKey: "settings.group.data",
		labelDefault: "Data",
		adminOnly: true,
	},
];

export const SETTINGS_ENTRIES: SettingsEntry[] = [
	{
		id: "profile",
		titleKey: "settings.profile.title",
		titleDefault: "Profile",
		descriptionKey: "settings.profile.description",
		descriptionDefault: "Manage your personal information and profile picture",
		href: "/settings/profile",
		icon: "user-circle",
		adminOnly: false,
		group: "account",
	},
	{
		id: "security",
		titleKey: "settings.security.title",
		titleDefault: "Security",
		descriptionKey: "settings.security.description",
		descriptionDefault: "Manage your password and active sessions",
		href: "/settings/security",
		icon: "shield",
		adminOnly: false,
		group: "account",
	},
	{
		id: "notifications",
		titleKey: "settings.notifications.title",
		titleDefault: "Notifications",
		descriptionKey: "settings.notifications.description",
		descriptionDefault: "Configure how you receive notifications",
		href: "/settings/notifications",
		icon: "bell",
		adminOnly: false,
		group: "account",
	},
	{
		id: "organizations",
		titleKey: "settings.organizations.title",
		titleDefault: "Organizations & Teams",
		descriptionKey: "settings.organizations.description",
		descriptionDefault: "Manage organization members, invitations, and teams",
		href: "/settings/organizations",
		icon: "building",
		adminOnly: false,
		group: "organization",
	},
	{
		id: "employees",
		titleKey: "settings.employees.title",
		titleDefault: "Employees",
		descriptionKey: "settings.employees.description",
		descriptionDefault: "Manage employee profiles, roles, and manager assignments",
		href: "/settings/employees",
		icon: "users",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "locations",
		titleKey: "settings.locations.title",
		titleDefault: "Locations",
		descriptionKey: "settings.locations.description",
		descriptionDefault: "Manage organization locations and subareas",
		href: "/settings/locations",
		icon: "map-pin",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "holidays",
		titleKey: "settings.holidays.title",
		titleDefault: "Holidays",
		descriptionKey: "settings.holidays.description",
		descriptionDefault: "Configure organization holidays and time off",
		href: "/settings/holidays",
		icon: "calendar-event",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "vacation",
		titleKey: "settings.vacation.title",
		titleDefault: "Vacation",
		descriptionKey: "settings.vacation.description",
		descriptionDefault: "Manage vacation policies and allowances",
		href: "/settings/vacation",
		icon: "beach",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "time-regulations",
		titleKey: "settings.timeRegulations.title",
		titleDefault: "Time Regulations",
		descriptionKey: "settings.timeRegulations.description",
		descriptionDefault: "Configure working time limits and break requirements",
		href: "/settings/time-regulations",
		icon: "gavel",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "work-schedules",
		titleKey: "settings.workSchedules.title",
		titleDefault: "Work Shifts",
		descriptionKey: "settings.workSchedules.description",
		descriptionDefault: "Manage work shift templates and assignments",
		href: "/settings/work-schedules",
		icon: "clock",
		adminOnly: true,
		group: "administration",
		requiredFeature: "shiftsEnabled",
	},
	{
		id: "surcharges",
		titleKey: "settings.surcharges.title",
		titleDefault: "Surcharges",
		descriptionKey: "settings.surcharges.description",
		descriptionDefault: "Configure time surcharges for overtime, night work, and holidays",
		href: "/settings/surcharges",
		icon: "percentage",
		adminOnly: true,
		group: "administration",
		requiredFeature: "surchargesEnabled",
	},
	{
		id: "projects",
		titleKey: "settings.projects.title",
		titleDefault: "Projects",
		descriptionKey: "settings.projects.description",
		descriptionDefault: "Manage projects, budgets, deadlines, and time assignments",
		href: "/settings/projects",
		icon: "briefcase",
		adminOnly: true,
		group: "administration",
		requiredFeature: "projectsEnabled",
	},
	// Enterprise settings
	{
		id: "custom-domains",
		titleKey: "settings.customDomains.title",
		titleDefault: "Domain & Branding",
		descriptionKey: "settings.customDomains.description",
		descriptionDefault: "Configure custom domain, branding, and SSO for your organization",
		href: "/settings/enterprise/domains",
		icon: "world",
		adminOnly: true,
		group: "enterprise",
	},
	{
		id: "audit-log",
		titleKey: "settings.auditLog.title",
		titleDefault: "Audit Log",
		descriptionKey: "settings.auditLog.description",
		descriptionDefault: "View activity history and security events",
		href: "/settings/enterprise/audit-log",
		icon: "history",
		adminOnly: true,
		group: "enterprise",
	},
	// Data settings
	{
		id: "statistics",
		titleKey: "settings.statistics.title",
		titleDefault: "Statistics",
		descriptionKey: "settings.statistics.description",
		descriptionDefault: "View statistics and metrics about your instance",
		href: "/settings/statistics",
		icon: "chart-bar",
		adminOnly: true,
		group: "data",
	},
	{
		id: "export",
		titleKey: "settings.export.title",
		titleDefault: "Data Export",
		descriptionKey: "settings.export.description",
		descriptionDefault: "Export organization data for backup or migration",
		href: "/settings/export",
		icon: "database-export",
		adminOnly: true,
		group: "data",
	},
	{
		id: "demo-data",
		titleKey: "settings.demoData.title",
		titleDefault: "Demo Data",
		descriptionKey: "settings.demoData.description",
		descriptionDefault: "Generate sample data for testing or clear all time-related data",
		href: "/settings/demo",
		icon: "test-pipe",
		adminOnly: true,
		group: "data",
	},
];

export function getVisibleSettings(isAdmin: boolean): SettingsEntry[] {
	return SETTINGS_ENTRIES.filter((entry) => !entry.adminOnly || isAdmin);
}

export function getVisibleGroups(isAdmin: boolean): SettingsGroupConfig[] {
	return SETTINGS_GROUPS.filter((group) => !group.adminOnly || isAdmin);
}

export function getEntriesByGroup(entries: SettingsEntry[], group: SettingsGroup): SettingsEntry[] {
	return entries.filter((entry) => entry.group === group);
}
