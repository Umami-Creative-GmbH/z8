"use client";

import {
	type Icon,
	IconBeach,
	IconBell,
	IconBuilding,
	IconCalendarEvent,
	IconHistory,
	IconShield,
	IconUserCircle,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { usePathname } from "next/navigation";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link } from "@/navigation";

interface SettingsNavItem {
	title: string;
	url: string;
	icon: Icon;
	visible: boolean;
}

interface SettingsNavProps {
	isAdmin: boolean;
}

export function SettingsNav({ isAdmin }: SettingsNavProps) {
	const pathname = usePathname();
	const { t } = useTranslate();

	const items: SettingsNavItem[] = [
		{
			title: t("settings.profile.title", "Profile"),
			url: "/settings/profile",
			icon: IconUserCircle,
			visible: true,
		},
		{
			title: t("settings.security.title", "Security"),
			url: "/settings/security",
			icon: IconShield,
			visible: true,
		},
		{
			title: t("settings.notifications.title", "Notifications"),
			url: "/settings/notifications",
			icon: IconBell,
			visible: true,
		},
		{
			title: t("settings.organizations.title", "Organizations & Teams"),
			url: "/settings/organizations",
			icon: IconBuilding,
			visible: true,
		},
		{
			title: t("settings.employees.title", "Employees"),
			url: "/settings/employees",
			icon: IconUsers,
			visible: isAdmin,
		},
		{
			title: t("settings.holidays.title", "Holidays"),
			url: "/settings/holidays",
			icon: IconCalendarEvent,
			visible: isAdmin,
		},
		{
			title: t("settings.vacation.title", "Vacation"),
			url: "/settings/vacation",
			icon: IconBeach,
			visible: isAdmin,
		},
		{
			title: t("settings.auditLog.title", "Audit Log"),
			url: "/settings/audit-log",
			icon: IconHistory,
			visible: isAdmin,
		},
	];

	const visibleItems = items.filter((item) => item.visible);

	return (
		<SidebarGroup>
			<SidebarGroupContent>
				<SidebarMenu>
					{visibleItems.map((item) => {
						const isActive = pathname?.startsWith(item.url);

						return (
							<SidebarMenuItem key={item.title}>
								<SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
									<Link href={item.url}>
										<item.icon className="size-5" />
										<span>{item.title}</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
