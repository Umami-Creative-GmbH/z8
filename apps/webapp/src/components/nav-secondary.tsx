"use client";

import { type Icon, IconExternalLink } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type * as React from "react";

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/navigation";
import { activeNavHref } from "./nav-active";

export function NavSecondary({
	items,
	allNavHrefs,
	...props
}: {
	items: {
		title: string;
		url: string;
		icon: Icon;
		external?: boolean;
	}[];
	allNavHrefs?: readonly string[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
	const pathname = usePathname();
	const { t } = useTranslate();
	const internalHrefs =
		allNavHrefs ?? items.filter((item) => !item.external).map((item) => item.url);
	const activeUrl = activeNavHref(pathname, internalHrefs);

	return (
		<SidebarGroup {...props}>
			<nav aria-label={t("nav.secondary-label", "Settings & help")}>
				<SidebarGroupContent>
					<SidebarMenu>
						{items.map((item) => {
							const isActive = !item.external && item.url === activeUrl;

							return (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
										<Link
											href={item.url}
											aria-label={item.title}
											aria-current={isActive ? "page" : undefined}
											rel={item.external ? "noreferrer" : undefined}
											target={item.external ? "_blank" : undefined}
										>
											<item.icon />
											<span>{item.title}</span>
											{item.external && (
												<IconExternalLink
													aria-hidden="true"
													className="ml-auto"
													data-testid="external-link-icon"
												/>
											)}
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroupContent>
			</nav>
		</SidebarGroup>
	);
}
