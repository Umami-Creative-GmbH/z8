"use client";

import { useTranslate } from "@tolgee/react";
import { DashboardHeaderCustomize } from "@/components/dashboard/dashboard-header-customize";
import { NotificationBell } from "@/components/notifications";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { TimeClockPopover } from "@/components/time-tracking/time-clock-popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePathname } from "@/navigation";

export function SiteHeader() {
	const { t } = useTranslate();
	const timeFormat = useTimeFormat();
	const pathname = usePathname();
	const normalizedPath = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
	const isDashboardRoute = normalizedPath === "/" || normalizedPath === "";

	// Map routes to title translation keys
	const getTitleKey = () => {
		if (normalizedPath === "/" || normalizedPath === "")
			return "dashboard.title";
		if (normalizedPath.startsWith("/notifications"))
			return "notifications.title";
		if (normalizedPath.startsWith("/calendar")) return "calendar.title";
		if (normalizedPath.startsWith("/time-tracking"))
			return "timeTracking.title";
		if (normalizedPath.startsWith("/absences")) return "absences.title";
		if (normalizedPath.startsWith("/travel-expenses"))
			return "settings.travelExpenses.title";
		if (normalizedPath.startsWith("/reports")) return "reports.title";
		if (normalizedPath.startsWith("/settings/holidays"))
			return "settings.holidays.title";
		if (normalizedPath.startsWith("/settings")) return "settings.title";
		if (normalizedPath.startsWith("/team")) return "team.title";

		return "dashboard.title"; // Default fallback
	};

	const getDefaultTitle = () => {
		if (normalizedPath === "/" || normalizedPath === "") return "Dashboard";
		if (normalizedPath.startsWith("/notifications")) return "Notifications";
		if (normalizedPath.startsWith("/calendar")) return "Calendar";
		if (normalizedPath.startsWith("/time-tracking")) return "Time Tracking";
		if (normalizedPath.startsWith("/absences")) return "Absences";
		if (normalizedPath.startsWith("/travel-expenses")) return "Travel Expenses";
		if (normalizedPath.startsWith("/reports")) return "Reports";
		if (normalizedPath.startsWith("/settings/holidays"))
			return "Holiday Management";
		if (normalizedPath.startsWith("/settings")) return "Settings";
		if (normalizedPath.startsWith("/team")) return "Team";

		return "Dashboard"; // Default fallback
	};

	const titleKey = getTitleKey();
	const defaultTitle = getDefaultTitle();

	return (
		<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator
					className="mx-2 data-[orientation=vertical]:h-4"
					orientation="vertical"
				/>
				<h1 className="font-medium text-base">{t(titleKey, defaultTitle)}</h1>
				<div className="ml-auto flex items-center gap-2">
					{isDashboardRoute ? <DashboardHeaderCustomize /> : null}
					<NotificationBell />
					<TimeClockPopover timeFormat={timeFormat} />
				</div>
			</div>
		</header>
	);
}
