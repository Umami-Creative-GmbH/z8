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
import { Link } from "@/navigation";

export function NavMain({
	items,
	label,
}: {
	items: {
		title: string;
		url: string;
		icon?: Icon;
		dataTour?: string;
	}[];
	label?: ReactNode;
}) {
	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarGroupContent>
				<SidebarMenu>
					{items.map((item) => (
						<SidebarMenuItem key={item.title} data-tour={item.dataTour}>
							<SidebarMenuButton asChild tooltip={item.title}>
								<Link href={item.url}>
									{item.icon && <item.icon />}
									<span>{item.title}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
