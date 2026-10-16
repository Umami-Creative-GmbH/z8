"use client";

import {
	IconAdjustmentsHorizontal,
	IconClock,
	IconDots,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DashboardHeaderCustomize } from "@/components/dashboard/dashboard-header-customize";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { HeaderTimezoneControl } from "@/components/header-timezone-control";
import { NotificationBell } from "@/components/notifications";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { TimeClockPopover } from "@/components/time-tracking/time-clock-popover";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
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
	const moreActionsLabel = t("common.moreActions", "More actions");

	return (
		// Edge to edge (store app shell, #846) the header sits below the status bar.
		<header className="box-content flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-white dark:bg-background pt-[env(safe-area-inset-top)] transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full min-w-0 items-center gap-2 px-3 sm:px-4 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator
					className="mx-2 hidden data-[orientation=vertical]:h-4 sm:block"
					orientation="vertical"
				/>
				{/* Truncates on phones so the clock and notification controls stay on screen. */}
				<h1 className="min-w-0 flex-1 truncate font-medium text-base">
					{t(routeMetadata.titleKey, routeMetadata.titleDefault)}
				</h1>
				<div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
					<div className="hidden items-center gap-2 sm:flex">
						{isDashboardRoute ? <DashboardHeaderCustomize /> : null}
						<HeaderTimezoneControl />
					</div>
					<TimeClockPopover timeFormat={timeFormat} />
					<div className="hidden sm:block">
						<HeaderRefreshButton />
					</div>
					<NotificationBell />
					<Popover>
						<PopoverTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-9 shrink-0 sm:hidden"
								aria-label={moreActionsLabel}
							>
								<IconDots className="size-4" aria-hidden="true" />
								<span className="sr-only">{moreActionsLabel}</span>
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="end"
							className="w-64 max-w-[calc(100vw-1.5rem)] space-y-1 p-2 sm:hidden"
							aria-label={moreActionsLabel}
						>
							{isDashboardRoute ? (
								<DashboardHeaderCustomize
									trigger={
										<Button
											type="button"
											variant="ghost"
											className="min-h-11 w-full justify-start gap-3 px-3"
										>
											<IconAdjustmentsHorizontal
												className="size-4"
												aria-hidden="true"
											/>
											{t("dashboard.customize.trigger", "Customize dashboard")}
										</Button>
									}
								/>
							) : null}
							<HeaderTimezoneControl
								trigger={
									<Button
										type="button"
										variant="ghost"
										className="min-h-11 w-full justify-start gap-3 px-3"
									>
										<IconClock className="size-4" aria-hidden="true" />
										{t("header.timezone.savedTimezone", "Saved timezone")}
									</Button>
								}
							/>
							<HeaderRefreshButton className="min-h-11 w-full justify-start gap-3 px-3">
								{t("common.refreshData", "Refresh data")}
							</HeaderRefreshButton>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</header>
	);
}
