"use client";

import type { Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";
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

export function NavMain({
	items,
	label,
}: {
	items: {
		title: string;
		url: string;
		icon?: Icon;
		/** Rendered after the item's button, e.g. a SidebarMenuBadge count. */
		badge?: ReactNode;
	}[];
	label?: ReactNode;
}) {
	const pathname = usePathname();
	const activeUrl = activeNavHref(
		pathname,
		items.map((item) => item.url),
	);

	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
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
								{item.badge}
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
