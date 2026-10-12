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
		// Edge to edge (store app shell, #846) the header sits below the status bar.
		<header className="box-content flex h-(--header-height) shrink-0 items-center gap-2 border-b pt-[env(safe-area-inset-top)] transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator
					className="mx-2 data-[orientation=vertical]:h-4"
					orientation="vertical"
				/>
				{/* Truncates on phones so the clock and notification controls stay on screen. */}
				<h1 className="min-w-0 truncate font-medium text-base">
					{t(routeMetadata.titleKey, routeMetadata.titleDefault)}
				</h1>
				<div className="ml-auto flex shrink-0 items-center gap-2">
					{isDashboardRoute ? <DashboardHeaderCustomize /> : null}
					<HeaderTimezoneControl />
					<TimeClockPopover timeFormat={timeFormat} />
					<NotificationBell />
				</div>
			</div>
		</header>
	);
}
