"use client";

import {
	IconBeach,
	IconCalendar,
	IconCalendarEvent,
	IconClipboardCheck,
	IconClock,
	IconDashboard,
	IconHelp,
	IconReport,
	IconSettings,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type * as React from "react";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTeam } from "@/components/nav-team";
import { NavUser } from "@/components/nav-user";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";
import type { UserOrganization } from "@/lib/auth-helpers";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	organizations?: UserOrganization[];
	currentOrganization?: UserOrganization | null;
	employeeRole?: "admin" | "manager" | "employee" | null;
	shiftsEnabled?: boolean;
}

const isManagerOrAbove = (role: "admin" | "manager" | "employee" | null | undefined): boolean => {
	return role === "admin" || role === "manager";
};

export function AppSidebar({
	organizations = [],
	currentOrganization = null,
	employeeRole = null,
	shiftsEnabled = false,
	...props
}: AppSidebarProps) {
	const { t } = useTranslate();
	const { data: session, isPending } = useSession();

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
			title: t("nav.absences", "Absences"),
			url: "/absences",
			icon: IconBeach,
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
			url: "/approvals",
			icon: IconClipboardCheck,
		},
	];

	const navSecondary = [
		{
			title: t("nav.settings", "Settings"),
			url: "/settings",
			icon: IconSettings,
		},
		{
			title: t("nav.get-help", "Get Help"),
			url: "#",
			icon: IconHelp,
		},
	];

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher
					organizations={organizations}
					currentOrganization={currentOrganization}
					canCreateOrganizations={session?.user?.canCreateOrganizations || session?.user?.role === "admin"}
				/>
			</SidebarHeader>
			<SidebarContent>
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
