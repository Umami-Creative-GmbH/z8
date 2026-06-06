"use client";

import {
	IconActivityHeartbeat,
	IconBuilding,
	IconChartBar,
	IconChartLine,
	IconCreditCard,
	IconLogout,
	IconMailCog,
	IconServer,
	IconSettings,
	IconUsers,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Link, usePathname } from "@/navigation";

export type PlatformAdminNavItem = {
	href: string;
	icon: keyof typeof platformAdminIcons;
	label: string;
};

export const platformAdminIcons = {
	analytics: IconChartLine,
	billing: IconCreditCard,
	diagnostics: IconActivityHeartbeat,
	organizations: IconBuilding,
	overview: IconChartBar,
	settings: IconSettings,
	systemEmailTemplates: IconMailCog,
	users: IconUsers,
	workerQueue: IconServer,
} satisfies Record<string, ComponentType<{ className?: string; "aria-hidden"?: "true" }>>;

type PlatformAdminHeaderActionsProps = {
	navItems: readonly PlatformAdminNavItem[];
	exitLabel: string;
	showExit?: boolean;
};

export function isActivePlatformAdminItem(pathname: string, item: PlatformAdminNavItem) {
	if (item.href === "/platform-admin") {
		return pathname === item.href;
	}

	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function PlatformAdminHeaderActions({
	navItems,
	exitLabel,
	showExit = true,
}: PlatformAdminHeaderActionsProps) {
	const pathname = usePathname();

	return (
		<>
			<nav className="hidden items-center gap-1 md:flex">
				{navItems.map((item) => {
					const isActive = isActivePlatformAdminItem(pathname, item);
					const Icon = platformAdminIcons[item.icon];

					return (
						<Tooltip key={item.href}>
							<TooltipTrigger asChild>
								<Link
									href={item.href}
									aria-label={item.label}
									title={item.label}
									className={cn(
										"flex size-9 items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
										isActive
											? "bg-accent text-accent-foreground"
											: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
									)}
								>
									<Icon className="size-4" aria-hidden="true" />
								</Link>
							</TooltipTrigger>
							<TooltipContent side="bottom" sideOffset={6}>
								{item.label}
							</TooltipContent>
						</Tooltip>
					);
				})}
			</nav>

			{showExit ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Link
							href="/"
							aria-label={exitLabel}
							title={exitLabel}
							className="flex size-9 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
						>
							<IconLogout className="size-4" aria-hidden="true" />
						</Link>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={6}>
						{exitLabel}
					</TooltipContent>
				</Tooltip>
			) : null}
		</>
	);
}
