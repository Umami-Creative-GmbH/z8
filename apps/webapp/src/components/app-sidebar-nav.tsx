import type * as React from "react";
import { FinanceNavBadge } from "@/components/travel-expenses/finance/finance-nav-badge";
import {
	getSidebarManifestEntries,
	type NavigationCapabilities,
	type NavigationEmployeeRole,
	type NavigationIcon,
	type NavigationManifestEntry,
	type SidebarSection,
} from "@/lib/navigation/navigation-manifest";

export type { NavigationCapabilities } from "@/lib/navigation/navigation-manifest";

export type SidebarEmployeeRole = NavigationEmployeeRole;

type Translate = (key: string, defaultValue: string) => string;

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
): SidebarNavItem[] {
	return getSidebarManifestEntries(section, {
		employeeRole,
		settingsAccessTier: "member",
		navigationCapabilities,
	}).map((entry) => toSidebarNavItem(entry, t));
}

// Personal section - visible to ALL users
export function buildPersonalNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
) {
	return buildSectionNav("workplace", t, navigationCapabilities, employeeRole);
}

/**
 * Team & organization section. Its team pages are for managers and above; a verifier or
 * planner without that role sees only Driving licences (#1937). An empty list hides the section.
 */
export function buildTeamNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
) {
	return buildSectionNav("team", t, navigationCapabilities, employeeRole);
}

export function buildSecondaryNav(t: Translate, navigationCapabilities: NavigationCapabilities) {
	return buildSectionNav("secondary", t, navigationCapabilities, null);
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
