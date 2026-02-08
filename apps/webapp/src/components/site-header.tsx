"use client";

import { IconPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { NotificationBell } from "@/components/notifications";
import { TimeClockPopover } from "@/components/time-tracking/time-clock-popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePathname } from "@/navigation";

export function SiteHeader() {
	const { t } = useTranslate();
	const pathname = usePathname();

	// Map routes to title translation keys
	const getTitleKey = () => {
		// Remove locale prefix (e.g., "/en/calendar" -> "/calendar")
		const path = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");

		if (path === "/" || path === "") return "dashboard.title";
		if (path.startsWith("/calendar")) return "calendar.title";
		if (path.startsWith("/time-tracking")) return "timeTracking.title";
		if (path.startsWith("/absences")) return "absences.title";
		if (path.startsWith("/reports")) return "reports.title";
		if (path.startsWith("/settings/holidays")) return "settings.holidays.title";
		if (path.startsWith("/settings")) return "settings.title";
		if (path.startsWith("/team")) return "team.title";

		return "dashboard.title"; // Default fallback
	};

	const getDefaultTitle = () => {
		const path = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");

		if (path === "/" || path === "") return "Dashboard";
		if (path.startsWith("/calendar")) return "Calendar";
		if (path.startsWith("/time-tracking")) return "Time Tracking";
		if (path.startsWith("/absences")) return "Absences";
		if (path.startsWith("/reports")) return "Reports";
		if (path.startsWith("/settings/holidays")) return "Holiday Management";
		if (path.startsWith("/settings")) return "Settings";
		if (path.startsWith("/team")) return "Team";

		return "Dashboard"; // Default fallback
	};

	const titleKey = getTitleKey();
	const defaultTitle = getDefaultTitle();

	return (
		<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator className="mx-2 data-[orientation=vertical]:h-4" orientation="vertical" />
				<h1 className="font-medium text-base">{t(titleKey, defaultTitle)}</h1>
				<div className="ml-auto flex items-center gap-2">
					<Button size="sm" variant="outline">
						<IconPlus className="size-4" />
						<span className="hidden sm:inline">
							{t("header.request-absence", "Request Absence")}
						</span>
					</Button>
					<NotificationBell />
					<TimeClockPopover />
				</div>
			</div>
		</header>
	);
}
