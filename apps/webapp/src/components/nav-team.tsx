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
import { Link } from "@/navigation";

export function NavTeam({
	items,
}: {
	items: {
		title: string;
		url: string;
		icon?: Icon;
		dataTour?: string;
	}[];
}) {
	const { t } = useTranslate();

	return (
		<SidebarGroup data-tour="nav-team-section">
			<SidebarGroupLabel>{t("nav.team-label", "Team")}</SidebarGroupLabel>
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
