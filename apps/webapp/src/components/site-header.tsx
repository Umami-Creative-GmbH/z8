"use client";

import { useTranslate } from "@tolgee/react";
import { DashboardHeaderCustomize } from "@/components/dashboard/dashboard-header-customize";
import { HeaderTimezoneControl } from "@/components/header-timezone-control";
import { NotificationBell } from "@/components/notifications";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { TimeClockPopover } from "@/components/time-tracking/time-clock-popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
	normalizeAppPath,
	resolveAppRouteMetadata,
} from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

export function SiteHeader() {
	const { t } = useTranslate();
	const timeFormat = useTimeFormat();
	const pathname = usePathname();
	const normalizedPath = normalizeAppPath(pathname);
	const isDashboardRoute = normalizedPath === "/" || normalizedPath === "";
	const routeMetadata = resolveAppRouteMetadata(pathname);

	return (
		<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator
					className="mx-2 data-[orientation=vertical]:h-4"
					orientation="vertical"
				/>
				<h1 className="font-medium text-base">
					{t(routeMetadata.titleKey, routeMetadata.titleDefault)}
				</h1>
				<div className="ml-auto flex items-center gap-2">
					{isDashboardRoute ? <DashboardHeaderCustomize /> : null}
					<HeaderTimezoneControl />
					<TimeClockPopover timeFormat={timeFormat} />
					<NotificationBell />
				</div>
			</div>
		</header>
	);
}
