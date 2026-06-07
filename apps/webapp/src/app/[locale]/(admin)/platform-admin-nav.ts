import {
	IconActivityHeartbeat,
	IconBuilding,
	IconChartBar,
	IconChartLine,
	IconCreditCard,
	IconMailCog,
	IconServer,
	IconSettings,
	IconUsers,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

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

export type PlatformAdminNavItem = {
	href: string;
	icon: keyof typeof platformAdminIcons;
	label: string;
};

export function isActivePlatformAdminItem(pathname: string, item: PlatformAdminNavItem) {
	if (item.href === "/platform-admin") {
		return pathname === item.href;
	}

	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
