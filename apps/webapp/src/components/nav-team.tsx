"use client";

import type { Icon } from "@tabler/icons-react";
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
import { activeNavHref } from "./nav-active";

export function NavTeam({
	items,
}: {
	items: {
		title: string;
		url: string;
		icon?: Icon;
	}[];
}) {
	const { t } = useTranslate();
	const pathname = usePathname();
	const activeUrl = activeNavHref(
		pathname,
		items.map((item) => item.url),
	);

	return (
		<SidebarGroup>
			<SidebarGroupLabel>{t("nav.team-label", "Team")}</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{items.map((item) => {
						const isActive = item.url === activeUrl;

						return (
							<SidebarMenuItem key={item.title}>
								<SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
									<Link href={item.url}>
										{item.icon && <item.icon />}
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
