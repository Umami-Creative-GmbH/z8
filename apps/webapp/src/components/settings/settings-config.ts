import {
	hasSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";

export type SettingsGroup =
	| "account"
	| "organization"
	| "time-tracking"
	| "scheduling"
	| "policies"
	| "projects"
	| "payroll"
	| "notifications"
	| "integrations"
	| "compliance"
	| "data";

export type FeatureFlag =
	| "shiftsEnabled"
	| "projectsEnabled"
	| "surchargesEnabled"
	| "demoDataEnabled"
	| "worksCouncilEnabled"
	| "billableTimeEnabled"
	| "personnelFilesEnabled";

export type FeatureFlagState = Partial<Record<FeatureFlag, boolean>>;

interface ResolveSettingsVisibilityInput {
	accessTier: SettingsAccessTier;
	billingEnabled?: boolean;
	featureFlags?: FeatureFlagState;
	/** The caller manages at least one project of the organization (#928). */
	managesProject?: boolean;
	/**
	 * The driving licence visibility reader offers its settings to the caller (#1420).
	 * Hidden unless a server caller passes the reader's answer.
	 */
	drivingLicenceSettingsVisible?: boolean;
}

export type SettingsIconName =
	| "lock"
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
	| "git-branch"
	| "gavel"
	| "percentage"
	| "address-book"
	| "briefcase"
	| "world"
	| "history"
	| "chart-bar"
	| "database-export"
	| "test-pipe"
	| "user-dollar"
	| "mail"
	| "tag"
	| "server"
	| "key"
	| "webhook"
	| "calendar-sync"
	| "target"
	| "certificate"
	| "credit-card"
	| "file-text"
	| "brand-discord"
	| "brand-slack"
	| "brand-teams"
	| "brand-telegram"
	| "database-import"
	| "receipt"
	| "device-tablet"
	| "forms"
	| "share"
	| "car"
	| "messages";

export interface SettingsEntry {
	id: string;
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	href: string;
	icon: SettingsIconName;
	minimumTier: SettingsAccessTier;
	group: SettingsGroup;
	/** Feature flag that must be enabled for this setting to be accessible */
	requiredFeature?: FeatureFlag;
	/** If true, only show when BILLING_ENABLED=true (checked at runtime) */
	requiresBilling?: boolean;
	/** If true, also show below `minimumTier` to users who manage a project (#928) */
	visibleToProjectManagers?: boolean;
	/** If true, show only when the driving licence visibility reader offers its settings (#1420) */
	requiresDrivingLicenceSettings?: boolean;
}

export interface SettingsGroupConfig {
	id: SettingsGroup;
	labelKey: string;
	labelDefault: string;
}

export const SETTINGS_GROUPS: SettingsGroupConfig[] = [
	{
		id: "account",
		labelKey: "settings.group.account",
		labelDefault: "Account",
	},
	{
		id: "organization",
		labelKey: "settings.group.organization",
		labelDefault: "Organization",
	},
	{
		id: "policies",
		labelKey: "settings.changePolicies.tab.policies",
		labelDefault: "Policies",
	},
	{
		id: "time-tracking",
		labelKey: "nav.time-tracking",
		labelDefault: "Time Tracking",
	},
	{
		id: "scheduling",
		labelKey: "nav.scheduling",
		labelDefault: "Scheduling",
	},
	{
		id: "projects",
		labelKey: "settings.projects.title",
		labelDefault: "Projects",
	},
	{
		id: "payroll",
		labelKey: "nav.payroll",
		labelDefault: "Payroll",
	},
	{
		id: "notifications",
		labelKey: "settings.group.notifications",
		labelDefault: "Notifications",
	},
	{
		id: "integrations",
		labelKey: "settings.group.integrations",
		labelDefault: "Integrations",
	},
	{
		id: "compliance",
		labelKey: "nav.compliance",
		labelDefault: "Compliance",
	},
	{
		id: "data",
		labelKey: "settings.group.data",
		labelDefault: "Data",
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
		minimumTier: "member",
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
		minimumTier: "member",
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
		minimumTier: "member",
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
		minimumTier: "member",
		group: "account",
	},
	{
		id: "position-stamps",
		titleKey: "settings.positionStamps.title",
		titleDefault: "Position stamps",
		descriptionKey: "settings.positionStamps.description",
		descriptionDefault:
			"Whether your position is recorded with your clock events, and your consent",
		href: "/settings/position-stamps",
		icon: "map-pin",
		minimumTier: "member",
		group: "account",
	},
	{
		id: "my-data",
		titleKey: "settings.myData.title",
		titleDefault: "My data",
		descriptionKey: "settings.myData.description",
		descriptionDefault:
			"Download a copy of the personal data this organization keeps about you",
		href: "/settings/my-data",
		icon: "database-export",
		minimumTier: "member",
		group: "account",
	},
	{
		id: "organizations",
		titleKey: "settings.organizations.title",
		titleDefault: "Organization",
		descriptionKey: "settings.organizations.description",
		descriptionDefault: "Manage organization details and configuration",
		href: "/settings/organizations",
		icon: "building",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "employees",
		titleKey: "settings.employees.title",
		titleDefault: "Employees",
		descriptionKey: "settings.employees.description",
		descriptionDefault: "Manage employees, members, and invites",
		href: "/settings/employees",
		icon: "users",
		minimumTier: "manager",
		group: "organization",
	},
	{
		id: "teams",
		titleKey: "settings.teams.title",
		titleDefault: "Teams",
		descriptionKey: "settings.teams.description",
		descriptionDefault:
			"Organize employees into teams and manage team assignments",
		href: "/settings/teams",
		icon: "users",
		minimumTier: "manager",
		group: "organization",
	},
	{
		id: "roles",
		titleKey: "settings.roles.title",
		titleDefault: "Custom Roles",
		descriptionKey: "settings.roles.description",
		descriptionDefault: "Create custom permission roles for your organization",
		href: "/settings/roles",
		icon: "shield-check",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "identity-access",
		titleKey: "settings.navigation.identityAccess.title",
		titleDefault: "Identity & Access",
		descriptionKey: "settings.navigation.identityAccess.description",
		descriptionDefault:
			"Configure SSO, social login, provisioning and organization access",
		href: "/settings/enterprise/identity-setup",
		icon: "key",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "locations",
		titleKey: "settings.locations.title",
		titleDefault: "Locations",
		descriptionKey: "settings.locations.description",
		descriptionDefault: "Manage organization locations and subareas",
		href: "/settings/locations",
		icon: "map-pin",
		minimumTier: "manager",
		group: "organization",
	},
	{
		id: "driving-licence",
		titleKey: "drivingLicence.title",
		titleDefault: "Driving licence control",
		descriptionKey: "drivingLicence.settingsDescription",
		descriptionDefault: "Configure original checks and enroll intended drivers",
		href: "/settings/driving-licence",
		icon: "shield-check",
		minimumTier: "orgAdmin",
		group: "compliance",
		requiresDrivingLicenceSettings: true,
	},
	{
		id: "vehicles",
		titleKey: "settings.vehicles.title",
		titleDefault: "Vehicles",
		descriptionKey: "settings.vehicles.description",
		descriptionDefault:
			"Vehicles your employees drive for work, and their assigned drivers",
		href: "/settings/vehicles",
		icon: "car",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "personnel-files",
		titleKey: "settings.personnelFiles.settings.title",
		titleDefault: "Personnel Files",
		descriptionKey: "settings.navigation.personnel-files.description",
		descriptionDefault:
			"Manage personnel file access, expiry reminders and document retention",
		href: "/settings/personnel-files",
		icon: "file-text",
		minimumTier: "orgAdmin",
		group: "organization",
		requiredFeature: "personnelFilesEnabled",
	},
	{
		id: "custom-fields",
		titleKey: "settings.customFields.title",
		titleDefault: "Custom fields",
		descriptionKey: "settings.customFields.description",
		descriptionDefault: "Your own fields on employees, projects and customers",
		href: "/settings/custom-fields",
		icon: "forms",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "custom-domains",
		titleKey: "settings.customDomains.title",
		titleDefault: "Domain & Branding",
		descriptionKey: "settings.navigation.domainBranding.description",
		descriptionDefault:
			"Configure your organization’s custom domain and branding",
		href: "/settings/enterprise/domains",
		icon: "world",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "implementation-checklist",
		titleKey: "settings.implementationChecklist.title",
		titleDefault: "Implementation Checklist",
		descriptionKey: "settings.implementationChecklist.description",
		descriptionDefault:
			"Track customer rollout setup across policies, payroll, integrations, and employee import",
		href: "/settings/implementation-checklist",
		icon: "target",
		minimumTier: "orgAdmin",
		group: "organization",
	},
	{
		id: "billing",
		titleKey: "settings.billing.title",
		titleDefault: "Billing & Subscription",
		descriptionKey: "settings.billing.description",
		descriptionDefault:
			"Manage your subscription, payment methods, and invoices",
		href: "/settings/billing",
		icon: "credit-card",
		minimumTier: "orgAdmin",
		group: "organization",
		requiresBilling: true,
	},
	{
		id: "work-policies",
		titleKey: "settings.workPolicies.title",
		titleDefault: "Work Policies",
		descriptionKey: "settings.workPolicies.description",
		descriptionDefault:
			"Configure work schedules, time limits, and break requirements",
		href: "/settings/work-policies",
		icon: "gavel",
		minimumTier: "manager",
		group: "policies",
	},
	{
		id: "absences",
		titleKey: "nav.absences",
		titleDefault: "Absences",
		descriptionKey: "settings.holidays.description",
		descriptionDefault: "Configure organization holidays and time off",
		href: "/settings/vacation",
		icon: "calendar-event",
		minimumTier: "manager",
		group: "policies",
	},
	{
		id: "travel-expenses",
		titleKey: "settings.travelExpenses.title",
		titleDefault: "Travel Expense Policies",
		descriptionKey: "settings.travelExpenses.navDescription",
		descriptionDefault:
			"Expense report review, receipts, currencies, mileage and per diem rates, and exceptions.",
		href: "/settings/travel-expenses",
		icon: "map-pin",
		minimumTier: "orgAdmin",
		group: "policies",
	},
	{
		id: "approval",
		titleKey: "settings.approvalEscalation.attention.approvalType",
		titleDefault: "Approval",
		descriptionKey: "settings.approvalPolicies.description",
		descriptionDefault:
			"Configure sequential approval chains for operational workflows",
		href: "/settings/approval-policies",
		icon: "git-branch",
		minimumTier: "orgAdmin",
		group: "policies",
	},
	{
		id: "clocking",
		titleKey: "settings.navigation.clocking.title",
		titleDefault: "Clocking",
		descriptionKey: "settings.navigation.clocking.description",
		descriptionDefault:
			"Configure tracking, automatic clock-out, reminders and period submissions",
		href: "/settings/clocking",
		icon: "clock",
		minimumTier: "orgAdmin",
		group: "time-tracking",
	},
	{
		id: "work-categories",
		titleKey: "settings.workCategories.title",
		titleDefault: "Work Categories",
		descriptionKey: "settings.workCategories.description",
		descriptionDefault:
			"Define work categories with time factors for effective time calculation",
		href: "/settings/work-categories",
		icon: "tag",
		minimumTier: "manager",
		group: "time-tracking",
	},
	{
		id: "position-capture",
		titleKey: "settings.positionCapture.title",
		titleDefault: "Position capture",
		descriptionKey: "settings.positionCapture.description",
		descriptionDefault:
			"Record positions with employees' own clock events, with their consent",
		href: "/settings/position-capture",
		icon: "map-pin",
		minimumTier: "orgAdmin",
		group: "time-tracking",
	},
	{
		id: "kiosks",
		titleKey: "settings.kiosks.title",
		titleDefault: "Kiosks",
		descriptionKey: "settings.kiosks.description",
		descriptionDefault:
			"Shared devices at a location where employees clock with their kiosk PIN",
		href: "/settings/kiosks",
		icon: "device-tablet",
		minimumTier: "orgAdmin",
		group: "time-tracking",
	},
	{
		id: "work-diagnostics",
		titleKey: "settings.workDiagnostics.title",
		titleDefault: "Work Diagnostics",
		descriptionKey: "settings.workDiagnostics.description",
		descriptionDefault:
			"Find missing or conflicting time records and time entry chain issues",
		href: "/settings/work-diagnostics",
		icon: "shield-check",
		minimumTier: "orgAdmin",
		group: "time-tracking",
	},
	{
		id: "skills",
		titleKey: "settings.skills.title",
		titleDefault: "Skills & Qualifications",
		descriptionKey: "settings.skills.description",
		descriptionDefault:
			"Manage skill catalog, certifications, and employee qualifications",
		href: "/settings/skills",
		icon: "certificate",
		minimumTier: "manager",
		group: "scheduling",
	},
	{
		id: "shift-planning",
		titleKey: "settings.navigation.shiftPlanning.title",
		titleDefault: "Shift Planning",
		descriptionKey: "settings.navigation.shiftPlanning.description",
		descriptionDefault: "Configure shift templates and coverage targets",
		href: "/settings/shifts",
		icon: "calendar-clock",
		minimumTier: "manager",
		group: "scheduling",
		requiredFeature: "shiftsEnabled",
	},
	{
		id: "customers",
		titleKey: "settings.customers.title",
		titleDefault: "Customers",
		descriptionKey: "settings.customers.description",
		descriptionDefault: "Manage customer contacts for project assignments",
		href: "/settings/customers",
		icon: "address-book",
		minimumTier: "manager",
		group: "projects",
		requiredFeature: "projectsEnabled",
	},
	{
		id: "projects",
		titleKey: "settings.projects.title",
		titleDefault: "Projects",
		descriptionKey: "settings.projects.description",
		descriptionDefault:
			"Manage projects, budgets, deadlines, and time assignments",
		href: "/settings/projects",
		icon: "briefcase",
		minimumTier: "manager",
		group: "projects",
		requiredFeature: "projectsEnabled",
		// Project managers below the manager tier get a tasks-only view (#872).
		visibleToProjectManagers: true,
	},
	{
		id: "billable-time",
		titleKey: "settings.billableTime.title",
		titleDefault: "Billable Time",
		descriptionKey: "settings.billableTime.description",
		descriptionDefault:
			"Billable currency and what your organization charges customers for work",
		href: "/settings/billable-time",
		icon: "receipt",
		minimumTier: "orgAdmin",
		group: "projects",
		requiredFeature: "billableTimeEnabled",
	},
	{
		id: "report-share-links",
		titleKey: "settings.reportShareLinks.title",
		titleDefault: "Report Share Links",
		descriptionKey: "settings.reportShareLinks.description",
		descriptionDefault:
			"See and revoke every link that shares a project or customer report",
		href: "/settings/report-share-links",
		icon: "share",
		minimumTier: "orgAdmin",
		group: "projects",
		requiredFeature: "projectsEnabled",
	},
	{
		id: "payroll-access",
		titleKey: "settings.payrollAccess.title",
		titleDefault: "Payroll Officers",
		descriptionKey: "settings.payrollAccess.description",
		descriptionDefault:
			"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
		href: "/settings/payroll-access",
		icon: "user-dollar",
		minimumTier: "orgAdmin",
		group: "payroll",
	},
	{
		id: "surcharges",
		titleKey: "settings.surcharges.title",
		titleDefault: "Surcharges",
		descriptionKey: "settings.surcharges.description",
		descriptionDefault:
			"Configure time surcharges for overtime, night work, and holidays",
		href: "/settings/surcharges",
		icon: "percentage",
		minimumTier: "manager",
		group: "payroll",
		requiredFeature: "surchargesEnabled",
	},
	{
		id: "payroll-readiness",
		titleKey: "settings.payrollReadiness.title",
		titleDefault: "Payroll Readiness",
		descriptionKey: "settings.payrollReadiness.description",
		descriptionDefault: "Check whether a payroll period is ready before export",
		href: "/settings/payroll-readiness",
		icon: "shield-check",
		minimumTier: "orgAdmin",
		group: "payroll",
	},
	{
		id: "payroll-export",
		titleKey: "settings.payrollExport.title",
		titleDefault: "Payroll Export",
		descriptionKey: "settings.payrollExport.description",
		descriptionDefault: "Export work periods to DATEV Lohn & Gehalt",
		href: "/settings/payroll-export",
		icon: "database-export",
		minimumTier: "orgAdmin",
		group: "payroll",
	},
	{
		id: "closed-months",
		titleKey: "settings.closedMonths.title",
		titleDefault: "Closed months",
		descriptionKey: "settings.closedMonths.description",
		descriptionDefault:
			"Close months after payroll so their work and absences can no longer change",
		href: "/settings/closed-months",
		icon: "lock",
		minimumTier: "orgAdmin",
		group: "payroll",
	},
	{
		id: "email",
		titleKey: "settings.navigation.email.title",
		titleDefault: "Email",
		descriptionKey: "settings.navigation.email.description",
		descriptionDefault:
			"Configure email delivery and customize message templates",
		href: "/settings/enterprise/email",
		icon: "mail",
		minimumTier: "orgAdmin",
		group: "notifications",
	},
	{
		id: "chat-integrations",
		titleKey: "settings.navigation.chat-integrations.title",
		titleDefault: "Chat Integrations",
		descriptionKey: "settings.navigation.chat-integrations.description",
		descriptionDefault:
			"Configure Slack, Microsoft Teams, Telegram and Discord",
		href: "/settings/notification-channels",
		icon: "messages",
		minimumTier: "orgAdmin",
		group: "notifications",
	},
	{
		id: "calendar",
		titleKey: "settings.calendar.title",
		titleDefault: "Calendar Sync",
		descriptionKey: "settings.calendar.description",
		descriptionDefault:
			"Configure calendar providers, ICS feeds, and sync settings",
		href: "/settings/calendar",
		icon: "calendar-sync",
		minimumTier: "manager",
		group: "integrations",
	},
	{
		id: "developer-access",
		titleKey: "settings.navigation.developerAccess.title",
		titleDefault: "Developer Access",
		descriptionKey: "settings.navigation.developerAccess.description",
		descriptionDefault: "Manage API keys and webhook endpoints",
		href: "/settings/enterprise/api-keys",
		icon: "key",
		minimumTier: "orgAdmin",
		group: "integrations",
	},
	{
		id: "works-council",
		titleKey: "settings.worksCouncil.title",
		titleDefault: "Works Council Mode",
		descriptionKey: "settings.worksCouncil.description",
		descriptionDefault:
			"Configure privacy-safe Betriebsrat access and review exports",
		href: "/settings/compliance/works-council",
		icon: "gavel",
		minimumTier: "orgAdmin",
		group: "compliance",
		requiredFeature: "worksCouncilEnabled",
	},
	{
		id: "audit",
		titleKey: "settings.navigation.audit.title",
		titleDefault: "Audit",
		descriptionKey: "settings.navigation.audit.description",
		descriptionDefault: "Review activity and configure signed audit exports",
		href: "/settings/audit-export",
		icon: "history",
		minimumTier: "orgAdmin",
		group: "compliance",
	},
	{
		id: "avv",
		titleKey: "settings.avv.title",
		titleDefault: "Data Processing Agreement",
		descriptionKey: "settings.avv.description",
		descriptionDefault:
			"Download your Data Processing Agreement (Auftragsverarbeitungsvertrag)",
		href: "/settings/avv",
		icon: "file-text",
		minimumTier: "orgAdmin",
		group: "compliance",
		requiresBilling: true,
	},
	{
		id: "data-import",
		titleKey: "settings.import.title",
		titleDefault: "Import Data",
		descriptionKey: "settings.import.description",
		descriptionDefault:
			"Import data from supported providers like Clockodo and Clockin",
		href: "/settings/import",
		icon: "database-import",
		minimumTier: "orgAdmin",
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
		minimumTier: "orgAdmin",
		group: "data",
	},
	{
		id: "scheduled-exports",
		titleKey: "settings.scheduledExports.title",
		titleDefault: "Scheduled Exports",
		descriptionKey: "settings.navigation.scheduled-exports.description",
		descriptionDefault: "Schedule recurring payroll, data and audit exports",
		href: "/settings/scheduled-exports",
		icon: "calendar-clock",
		minimumTier: "orgAdmin",
		group: "data",
	},
	{
		id: "export-operations",
		titleKey: "settings.exportOperations.title",
		titleDefault: "Export Operations",
		descriptionKey: "settings.exportOperations.description",
		descriptionDefault: "Monitor payroll, audit, and scheduled export activity",
		href: "/settings/export-operations",
		icon: "history",
		minimumTier: "orgAdmin",
		group: "data",
	},
	{
		id: "statistics",
		titleKey: "settings.statistics.title",
		titleDefault: "Statistics",
		descriptionKey: "settings.statistics.description",
		descriptionDefault: "View statistics and metrics about your instance",
		href: "/settings/statistics",
		icon: "chart-bar",
		minimumTier: "manager",
		group: "data",
	},
	{
		id: "demo-data",
		titleKey: "settings.demoData.title",
		titleDefault: "Demo Data",
		descriptionKey: "settings.demoData.description",
		descriptionDefault:
			"Generate sample data for testing or clear all time-related data",
		href: "/settings/demo",
		icon: "test-pipe",
		minimumTier: "orgAdmin",
		group: "data",
		requiredFeature: "demoDataEnabled",
	},
];

export function getVisibleSettings(
	accessTier: SettingsAccessTier,
	billingEnabled = false,
	managesProject = false,
	drivingLicenceSettingsVisible = false,
): SettingsEntry[] {
	return SETTINGS_ENTRIES.filter((entry) => {
		const projectManagerAccess =
			managesProject && entry.visibleToProjectManagers === true;
		if (
			!hasSettingsAccessTier(accessTier, entry.minimumTier) &&
			!projectManagerAccess
		) {
			return false;
		}
		if (entry.requiresBilling && !billingEnabled) return false;
		if (entry.requiresDrivingLicenceSettings && !drivingLicenceSettingsVisible) return false;
		return true;
	});
}

export function getVisibleGroups(
	entries: SettingsEntry[],
): SettingsGroupConfig[] {
	const visibleGroupIds = new Set(entries.map((entry) => entry.group));

	return SETTINGS_GROUPS.filter((group) => visibleGroupIds.has(group.id));
}

export function filterSettingsByFeatureFlags(
	entries: SettingsEntry[],
	featureFlags: FeatureFlagState,
): SettingsEntry[] {
	return entries.filter((entry) => {
		if (!entry.requiredFeature) return true;
		if (entry.requiredFeature === "demoDataEnabled") {
			return featureFlags.demoDataEnabled ?? true;
		}
		if (entry.requiredFeature === "billableTimeEnabled") {
			// Billable Time needs projects; never show it on a stale flag without them.
			return (
				(featureFlags.billableTimeEnabled ?? false) &&
				(featureFlags.projectsEnabled ?? false)
			);
		}

		return featureFlags[entry.requiredFeature] ?? false;
	});
}

export function getVisibleGroupsForFeatureFlags(
	entries: SettingsEntry[],
	featureFlags: FeatureFlagState,
): SettingsGroupConfig[] {
	return getVisibleGroups(filterSettingsByFeatureFlags(entries, featureFlags));
}

export function getResolvedSettingsVisibility({
	accessTier,
	billingEnabled = false,
	featureFlags,
	managesProject = false,
	drivingLicenceSettingsVisible = false,
}: ResolveSettingsVisibilityInput): {
	visibleSettings: SettingsEntry[];
	visibleGroups: SettingsGroupConfig[];
} {
	const tierVisibleSettings = getVisibleSettings(
		accessTier,
		billingEnabled,
		managesProject,
		drivingLicenceSettingsVisible,
	);
	const visibleSettings = featureFlags
		? filterSettingsByFeatureFlags(tierVisibleSettings, featureFlags)
		: tierVisibleSettings;
	const visibleGroups = getVisibleGroups(visibleSettings);

	return {
		visibleSettings,
		visibleGroups,
	};
}

export function getEntriesByGroup(
	entries: SettingsEntry[],
	group: SettingsGroup,
): SettingsEntry[] {
	return entries.filter((entry) => entry.group === group);
}
