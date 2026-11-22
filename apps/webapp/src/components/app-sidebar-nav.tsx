import type * as React from "react";
import type { FeatureFlagState } from "@/components/settings/settings-config";
import { FinanceNavBadge } from "@/components/travel-expenses/finance/finance-nav-badge";
import {
	getSidebarManifestEntries,
	type NavigationCapabilities,
	type NavigationEmployeeRole,
	type NavigationIcon,
	type NavigationManifestEntry,
	type SidebarSection,
} from "@/lib/navigation/navigation-manifest";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { SettingsCapabilities } from "@/lib/settings/capabilities";

export type { NavigationCapabilities } from "@/lib/navigation/navigation-manifest";

export type SidebarEmployeeRole = NavigationEmployeeRole;

type Translate = (key: string, defaultValue: string) => string;

export interface SidebarNavOptions {
	settingsAccess?: SettingsAccess | null;
	featureFlags?: FeatureFlagState;
	settingsCapabilities?: Partial<SettingsCapabilities>;
}

export interface SidebarNavItem {
	title: string;
	url: string;
	icon: NavigationIcon;
	badge?: React.ReactNode;
	external?: boolean;
}

function toSidebarNavItem(entry: NavigationManifestEntry, t: Translate): SidebarNavItem {
	return {
		title: t(entry.titleKey, entry.titleDefault),
		url: entry.href,
		icon: entry.icon,
		...(entry.badgeId === "finance" ? { badge: <FinanceNavBadge /> } : {}),
		...(entry.external ? { external: true } : {}),
	};
}

function buildSectionNav(
	section: Exclude<SidebarSection, "none">,
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
	options?: SidebarNavOptions,
): SidebarNavItem[] {
	return getSidebarManifestEntries(section, {
		employeeRole,
		settingsAccess: options?.settingsAccess ?? null,
		navigationCapabilities,
		featureFlags: options?.featureFlags,
		settingsCapabilities: options?.settingsCapabilities,
	}).map((entry) => toSidebarNavItem(entry, t));
}

// Personal section - visible to ALL users
export function buildPersonalNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
	options?: SidebarNavOptions,
) {
	return buildSectionNav("workplace", t, navigationCapabilities, employeeRole, options);
}

/**
 * Team section: manager and planner daily oversight, leading with Today (#1953).
 * An empty list hides the section.
 */
export function buildTeamNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
	options?: SidebarNavOptions,
) {
	return buildSectionNav("team", t, navigationCapabilities, employeeRole, options);
}

/**
 * Organization section: organization-wide and specialist officer consoles (#1953).
 * An empty list hides the section.
 */
export function buildOrganizationNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
	options?: SidebarNavOptions,
) {
	return buildSectionNav("organization", t, navigationCapabilities, employeeRole, options);
}

export function buildSecondaryNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	options?: SidebarNavOptions,
) {
	return buildSectionNav("secondary", t, navigationCapabilities, null, options);
}

interface SessionUserLike {
	id?: string | null;
	name?: string | null;
	email?: string | null;
	image?: string | null;
}

/** Maps the signed-in session user onto the footer's NavUser shape. */
export function toNavUser(user: SessionUserLike | null | undefined) {
	return {
		id: user?.id || "",
		name: user?.name || "",
		email: user?.email || "",
		avatar: user?.image ?? undefined,
	};
}
