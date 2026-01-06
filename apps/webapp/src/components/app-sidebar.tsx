"use client";

import {
	IconBeach,
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
import { Clock } from "lucide-react";
import type * as React from "react";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";
import type { UserOrganization } from "@/lib/auth-helpers";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	organizations?: UserOrganization[];
	currentOrganization?: UserOrganization | null;
}

export function AppSidebar({
	organizations = [],
	currentOrganization = null,
	...props
}: AppSidebarProps) {
	const { t } = useTranslate();
	const { data: session, isPending } = useSession();

	const navMain = [
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
			title: t("nav.absences", "Absences"),
			url: "/absences",
			icon: IconBeach,
		},
		{
			title: t("nav.calendar", "Calendar"),
			url: "/calendar",
			icon: IconCalendarEvent,
		},
		{
			title: t("nav.approvals", "Approvals"),
			url: "/approvals",
			icon: IconClipboardCheck,
		},
		{
			title: t("nav.reports", "Reports"),
			url: "#",
			icon: IconReport,
		},
		{
			title: t("nav.team", "Team"),
			url: "#",
			icon: IconUsers,
		},
	];

	const navSecondary = [
		{
			title: t("nav.settings", "Settings"),
			url: "/settings/vacation",
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
				/>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
							<a href="#">
								<Clock className="!size-5" />
								<span className="font-semibold text-base">z8</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navMain} />
				<NavSecondary className="mt-auto" items={navSecondary} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser
					user={{
						name: session?.user?.name || "",
						email: session?.user?.email || "",
						avatar: session?.user?.image,
					}}
					isLoading={isPending}
				/>
			</SidebarFooter>
		</Sidebar>
	);
}
