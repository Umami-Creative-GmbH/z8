export type SettingsGroup = "account" | "organization" | "administration" | "enterprise" | "data";

export type FeatureFlag = "shiftsEnabled" | "projectsEnabled" | "surchargesEnabled";

export type SettingsIconName =
	| "user-circle"
	| "shield"
	| "shield-check"
	| "bell"
	| "droplet"
	| "building"
	| "users"
	| "map-pin"
	| "calendar-event"
	| "calendar-clock"
	| "beach"
	| "clock"
	| "clock-edit"
	| "gavel"
	| "percentage"
	| "address-book"
	| "briefcase"
	| "world"
	| "history"
	| "chart-bar"
	| "database-export"
	| "test-pipe"
	| "mail"
	| "tag"
	| "server"
	| "key"
	| "webhook"
	| "calendar-sync"
	| "radar"
	| "target"
	| "certificate"
	| "credit-card"
	| "file-text";

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
	/** If true, only show when BILLING_ENABLED=true (checked at runtime) */
	requiresBilling?: boolean;
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
		id: "wellness",
		titleKey: "settings.wellness.title",
		titleDefault: "Wellness",
		descriptionKey: "settings.wellness.description",
		descriptionDefault: "Configure water reminders and hydration tracking",
		href: "/settings/wellness",
		icon: "droplet",
		adminOnly: false,
		group: "account",
	},
	{
		id: "organizations",
		titleKey: "settings.organizations.title",
		titleDefault: "Organization & Teams",
		descriptionKey: "settings.organizations.description",
		descriptionDefault: "Manage organization members, invitations, and teams",
		href: "/settings/organizations",
		icon: "building",
		adminOnly: false,
		group: "organization",
	},
	{
		id: "billing",
		titleKey: "settings.billing.title",
		titleDefault: "Billing & Subscription",
		descriptionKey: "settings.billing.description",
		descriptionDefault: "Manage your subscription, payment methods, and invoices",
		href: "/settings/billing",
		icon: "credit-card",
		adminOnly: true,
		group: "organization",
		requiresBilling: true,
	},
	{
		id: "avv",
		titleKey: "settings.avv.title",
		titleDefault: "Data Processing Agreement",
		descriptionKey: "settings.avv.description",
		descriptionDefault: "Download your Data Processing Agreement (Auftragsverarbeitungsvertrag)",
		href: "/settings/avv",
		icon: "file-text",
		adminOnly: true,
		group: "organization",
		requiresBilling: true,
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
		id: "work-policies",
		titleKey: "settings.workPolicies.title",
		titleDefault: "Work Policies",
		descriptionKey: "settings.workPolicies.description",
		descriptionDefault: "Configure work schedules, time limits, and break requirements",
		href: "/settings/work-policies",
		icon: "gavel",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "work-categories",
		titleKey: "settings.workCategories.title",
		titleDefault: "Work Categories",
		descriptionKey: "settings.workCategories.description",
		descriptionDefault: "Define work categories with time factors for effective time calculation",
		href: "/settings/work-categories",
		icon: "tag",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "change-policies",
		titleKey: "settings.changePolicies.title",
		titleDefault: "Change Policies",
		descriptionKey: "settings.changePolicies.description",
		descriptionDefault: "Control when employees can edit time entries and require manager approval",
		href: "/settings/change-policies",
		icon: "clock-edit",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "compliance-radar",
		titleKey: "settings.complianceRadar.title",
		titleDefault: "Compliance Radar",
		descriptionKey: "settings.complianceRadar.description",
		descriptionDefault: "Monitor labor-law compliance, view findings, and manage waivers",
		href: "/settings/compliance-radar",
		icon: "radar",
		adminOnly: true,
		group: "administration",
	},
	{
		id: "skills",
		titleKey: "settings.skills.title",
		titleDefault: "Skills & Qualifications",
		descriptionKey: "settings.skills.description",
		descriptionDefault: "Manage skill catalog, certifications, and employee qualifications",
		href: "/settings/skills",
		icon: "certificate",
		adminOnly: true,
		group: "administration",
	},
	// Optional features (require feature flag to be enabled)
	{
		id: "shift-templates",
		titleKey: "settings.shiftTemplates.title",
		titleDefault: "Shift Templates",
		descriptionKey: "settings.shiftTemplates.description",
		descriptionDefault: "Create reusable shift templates for scheduling (Morning, Night, etc.)",
		href: "/settings/shifts",
		icon: "calendar-clock",
		adminOnly: true,
		group: "administration",
		requiredFeature: "shiftsEnabled",
	},
	{
		id: "coverage-rules",
		titleKey: "settings.coverageRules.title",
		titleDefault: "Coverage Targets",
		descriptionKey: "settings.coverageRules.description",
		descriptionDefault: "Set minimum staffing requirements per location and time",
		href: "/settings/coverage-rules",
		icon: "target",
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
		id: "customers",
		titleKey: "settings.customers.title",
		titleDefault: "Customers",
		descriptionKey: "settings.customers.description",
		descriptionDefault: "Manage customer contacts for project assignments",
		href: "/settings/customers",
		icon: "address-book",
		adminOnly: true,
		group: "administration",
		requiredFeature: "projectsEnabled",
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
		id: "email-config",
		titleKey: "settings.emailConfig.title",
		titleDefault: "Email Configuration",
		descriptionKey: "settings.emailConfig.description",
		descriptionDefault: "Configure a custom email provider for organization emails",
		href: "/settings/enterprise/email",
		icon: "mail",
		adminOnly: true,
		group: "enterprise",
	},
	{
		id: "api-keys",
		titleKey: "settings.apiKeys.title",
		titleDefault: "API Keys",
		descriptionKey: "settings.apiKeys.description",
		descriptionDefault: "Manage API keys for programmatic access to your organization data",
		href: "/settings/enterprise/api-keys",
		icon: "key",
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
	{
		id: "webhooks",
		titleKey: "settings.webhooks.title",
		titleDefault: "Webhooks",
		descriptionKey: "settings.webhooks.description",
		descriptionDefault: "Configure webhook endpoints to receive real-time event notifications",
		href: "/settings/webhooks",
		icon: "webhook",
		adminOnly: true,
		group: "enterprise",
	},
	{
		id: "calendar",
		titleKey: "settings.calendar.title",
		titleDefault: "Calendar Sync",
		descriptionKey: "settings.calendar.description",
		descriptionDefault: "Configure calendar providers, ICS feeds, and sync settings",
		href: "/settings/calendar",
		icon: "calendar-sync",
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
		id: "worker-queue",
		titleKey: "settings.workerQueue.title",
		titleDefault: "Worker Queue",
		descriptionKey: "settings.workerQueue.description",
		descriptionDefault: "Monitor background job processing and cron job executions",
		href: "/settings/worker-queue",
		icon: "server",
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
		id: "payroll-export",
		titleKey: "settings.payrollExport.title",
		titleDefault: "Payroll Export",
		descriptionKey: "settings.payrollExport.description",
		descriptionDefault: "Export work periods to DATEV Lohn & Gehalt",
		href: "/settings/payroll-export",
		icon: "database-export",
		adminOnly: true,
		group: "data",
	},
	{
		id: "audit-export",
		titleKey: "settings.auditExport.title",
		titleDefault: "Audit Export",
		descriptionKey: "settings.auditExport.description",
		descriptionDefault: "GoBD-compliant export hardening with digital signatures",
		href: "/settings/audit-export",
		icon: "shield-check",
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

export function getVisibleSettings(isAdmin: boolean, billingEnabled = false): SettingsEntry[] {
	return SETTINGS_ENTRIES.filter((entry) => {
		// Check admin requirement
		if (entry.adminOnly && !isAdmin) return false;
		// Check billing requirement (hide completely when billing disabled)
		if (entry.requiresBilling && !billingEnabled) return false;
		return true;
	});
}

export function getVisibleGroups(isAdmin: boolean): SettingsGroupConfig[] {
	return SETTINGS_GROUPS.filter((group) => !group.adminOnly || isAdmin);
}

export function getEntriesByGroup(entries: SettingsEntry[], group: SettingsGroup): SettingsEntry[] {
	return entries.filter((entry) => entry.group === group);
}
