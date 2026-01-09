"use client";

import { useTranslate } from "@tolgee/react";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/navigation";
import { getEntriesByGroup, getVisibleGroups, getVisibleSettings } from "./settings-config";

interface SettingsNavProps {
	isAdmin: boolean;
}

export function SettingsNav({ isAdmin }: SettingsNavProps) {
	const pathname = usePathname();
	const { t } = useTranslate();

	const visibleItems = getVisibleSettings(isAdmin);
	const visibleGroups = getVisibleGroups(isAdmin);

	return (
		<>
			{visibleGroups.map((group) => {
				const groupEntries = getEntriesByGroup(visibleItems, group.id);

				if (groupEntries.length === 0) return null;

				return (
					<SidebarGroup key={group.id}>
						<SidebarGroupLabel>{t(group.labelKey, group.labelDefault)}</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{groupEntries.map((item) => {
									const isActive = pathname?.startsWith(item.href);
									const title = t(item.titleKey, item.titleDefault);

									return (
										<SidebarMenuItem key={item.id}>
											<SidebarMenuButton asChild isActive={isActive} tooltip={title}>
												<Link href={item.href}>
													<item.icon className="size-5" />
													<span>{title}</span>
												</Link>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				);
			})}
		</>
	);
}
