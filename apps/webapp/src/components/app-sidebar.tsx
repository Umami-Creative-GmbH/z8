"use client";

import {
	IconBeach,
	IconCalendar,
	IconCalendarEvent,
	IconClipboardCheck,
	IconClock,
	IconDashboard,
	IconFileDescription,
	IconHelp,
	IconHierarchy,
	IconMessageCircle,
	IconReceipt,
	IconReport,
	IconServerCog,
	IconSettings,
	IconShieldCheck,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type * as React from "react";
import { AppSearch } from "@/components/app-search";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTeam } from "@/components/nav-team";
import { NavUser } from "@/components/nav-user";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import type { FeatureFlagState } from "@/components/settings/settings-config";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { buildStaticAppSearchResults } from "@/lib/app-search/static-results";
import { useSession } from "@/lib/auth-client";
import type { UserOrganization } from "@/lib/auth-helpers";
import type { SettingsAccessTier } from "@/lib/settings-access";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	organizations?: UserOrganization[];
	currentOrganization?: UserOrganization | null;
	employeeRole?: "admin" | "manager" | "employee" | null;
	shiftsEnabled?: boolean;
	showComplianceNav?: boolean;
	showPlatformAdminNav?: boolean;
	settingsAccessTier?: SettingsAccessTier;
	billingEnabled?: boolean;
	featureFlags?: FeatureFlagState;
	canCreateOrganizations?: boolean;
}

const isManagerOrAbove = (role: "admin" | "manager" | "employee" | null | undefined): boolean => {
	return role === "admin" || role === "manager";
};

const EMPTY_ORGANIZATIONS: UserOrganization[] = [];

export function AppSidebar({
	organizations = EMPTY_ORGANIZATIONS,
	currentOrganization = null,
	employeeRole = null,
	shiftsEnabled = false,
	showComplianceNav = false,
	showPlatformAdminNav = false,
	settingsAccessTier = "member",
	billingEnabled = false,
	featureFlags,
	canCreateOrganizations = false,
	...props
}: AppSidebarProps) {
	const { t } = useTranslate();
	const { data: session, isPending } = useSession();
	const staticSearchResults = buildStaticAppSearchResults({
		t: (key, defaultValue) => t(key, defaultValue),
		employeeRole,
		settingsAccessTier,
		billingEnabled,
		showComplianceNav,
		featureFlags,
	});

	// Personal section - visible to ALL users
	const navPersonal = [
		{
			title: t("nav.dashboard", "Dashboard"),
			url: "/",
			icon: IconDashboard,
		},
		{
			title: t("nav.time-tracking", "Time Tracking"),
			url: "/time-tracking",
			icon: IconClock,
		},
		{
			title: t("nav.calendar", "Calendar"),
			url: "/calendar",
			icon: IconCalendarEvent,
		},
		{
			title: t("nav.my-requests", "My Requests"),
			url: "/my-requests",
			icon: IconFileDescription,
		},
		{
			title: t("nav.org-explorer", "Org Explorer"),
			url: "/organization",
			icon: IconHierarchy,
		},
		{
			title: t("nav.absences", "Absences"),
			url: "/absences",
			icon: IconBeach,
		},
		{
			title: t("nav.travel-expenses", "Travel Expenses"),
			url: "/travel-expenses",
			icon: IconReceipt,
		},
		{
			title: t("nav.reports", "Reports"),
			url: "/reports",
			icon: IconReport,
		},
	];

	// Team section - admin/manager only
	const navTeam = [
		{
			title: t("nav.team", "Team"),
			url: "/team",
			icon: IconUsers,
		},
		{
			title: t("nav.teamAbsences", "Team Absences"),
			url: "/team/absences",
			icon: IconBeach,
		},
		// Only show Scheduling when shifts are enabled for the organization
		...(shiftsEnabled
			? [
					{
						title: t("nav.scheduling", "Scheduling"),
						url: "/scheduling",
						icon: IconCalendar,
					},
				]
			: []),
		{
			title: t("nav.approvals", "Approvals"),
			url: "/approvals/inbox",
			icon: IconClipboardCheck,
		},
	];

	const navSecondary = [
		...(showComplianceNav
			? [
					{
						title: t("nav.compliance", "Compliance"),
						url: "/compliance",
						icon: IconShieldCheck,
					},
				]
			: []),
		{
			title: t("nav.settings", "Settings"),
			url: "/settings",
			icon: IconSettings,
		},
		{
			title: t("nav.get-help", "Get Help"),
			url: "https://docs.z8-time.app/docs",
			icon: IconHelp,
			external: true,
		},
		{
			title: t("nav.feedback", "Feedback"),
			url: "https://feedback.z8-time.app/",
			icon: IconMessageCircle,
			external: true,
		},
		...(showPlatformAdminNav
			? [
					{
						title: t("nav.platform-admin", "Platform Admin"),
						url: "/platform-admin",
						icon: IconServerCog,
					},
				]
			: []),
	];

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher
					organizations={organizations}
					currentOrganization={currentOrganization}
					canCreateOrganizations={canCreateOrganizations}
				/>
			</SidebarHeader>
			<SidebarContent>
				<AppSearch staticResults={staticSearchResults} />
				<NavMain items={navPersonal} label="z8 app" />
				{isManagerOrAbove(employeeRole) && <NavTeam items={navTeam} />}
				<NavSecondary className="mt-auto" items={navSecondary} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser
					user={{
						id: session?.user?.id || "",
						name: session?.user?.name || "",
						email: session?.user?.email || "",
						avatar: session?.user?.image ?? undefined,
					}}
					isLoading={isPending}
				/>
			</SidebarFooter>
		</Sidebar>
	);
}
