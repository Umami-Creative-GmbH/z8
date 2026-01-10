import type { Icon } from "@tabler/icons-react";
import {
	IconBeach,
	IconBell,
	IconBuilding,
	IconBuildingSkyscraper,
	IconCalendarEvent,
	IconClock,
	IconHistory,
	IconShield,
	IconUserCircle,
	IconUsers,
	IconWorld,
} from "@tabler/icons-react";

export type SettingsGroup = "account" | "organization" | "administration" | "enterprise";

export interface SettingsEntry {
	id: string;
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	href: string;
	icon: Icon;
	adminOnly: boolean;
	group: SettingsGroup;
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
];

export const SETTINGS_ENTRIES: SettingsEntry[] = [
	{
		id: "profile",
		titleKey: "settings.profile.title",
		titleDefault: "Profile",
		descriptionKey: "settings.profile.description",
		descriptionDefault: "Manage your personal information and profile picture",
		href: "/settings/profile",
		icon: IconUserCircle,
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
		icon: IconShield,
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
		icon: IconBell,
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
		icon: IconBuilding,
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
		icon: IconUsers,
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
		icon: IconCalendarEvent,
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
		icon: IconBeach,
		adminOnly: true,
		group: "administration",
	},
	{
		id: "work-schedules",
		titleKey: "settings.workSchedules.title",
		titleDefault: "Work Schedules",
		descriptionKey: "settings.workSchedules.description",
		descriptionDefault: "Manage work schedule templates and assignments",
		href: "/settings/work-schedules",
		icon: IconClock,
		adminOnly: true,
		group: "administration",
	},
	// Enterprise settings
	{
		id: "custom-domains",
		titleKey: "settings.customDomains.title",
		titleDefault: "Domain & Branding",
		descriptionKey: "settings.customDomains.description",
		descriptionDefault: "Configure custom domain, branding, and SSO for your organization",
		href: "/settings/enterprise/domains",
		icon: IconWorld,
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
		icon: IconHistory,
		adminOnly: true,
		group: "enterprise",
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
