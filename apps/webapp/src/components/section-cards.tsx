"use client";

import { BirthdayRemindersWidget } from "@/components/dashboard/birthday-reminders-widget";
import { HydrationWidget } from "@/components/dashboard/hydration-widget";
import { ManagedEmployeesWidget } from "@/components/dashboard/managed-employees-widget";
import { PendingApprovalsWidget } from "@/components/dashboard/pending-approvals-widget";
import { QuickStatsWidget } from "@/components/dashboard/quick-stats-widget";
import { RecentlyApprovedWidget } from "@/components/dashboard/recently-approved-widget";
import { SortableWidgetGrid } from "@/components/dashboard/sortable-widget-grid";
import { TeamOverviewWidget } from "@/components/dashboard/team-overview-widget";
import { UpcomingTimeOffWidget } from "@/components/dashboard/upcoming-time-off-widget";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";
import { VacationBalanceWidget } from "@/components/dashboard/vacation-balance-widget";
import { WidgetVisibilityProvider } from "@/components/dashboard/widget-visibility-context";
import type { WidgetId } from "@/components/dashboard/widget-registry";
import { WhosOutTodayWidget } from "@/components/dashboard/whos-out-today-widget";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Map of widget IDs to their component.
 * Widgets handle their own DashboardWidget wrapper internally.
 */
const WIDGET_COMPONENTS: Record<WidgetId, React.ComponentType> = {
	"managed-employees": ManagedEmployeesWidget,
	"pending-approvals": PendingApprovalsWidget,
	"team-overview": TeamOverviewWidget,
	"quick-stats": QuickStatsWidget,
	"whos-out-today": WhosOutTodayWidget,
	"upcoming-time-off": UpcomingTimeOffWidget,
	"recently-approved": RecentlyApprovedWidget,
	"birthday-reminders": BirthdayRemindersWidget,
	hydration: HydrationWidget,
	"vacation-balance": VacationBalanceWidget,
};

function WidgetSkeleton() {
	return (
		<div className="rounded-xl border bg-card p-6">
			<div className="flex items-center justify-between mb-4">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="h-4 w-4 rounded-full" />
			</div>
			<div className="space-y-3">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-4 w-1/2" />
			</div>
		</div>
	);
}

export function SectionCardsSkeleton() {
	return (
		<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6 items-start">
			{Array.from({ length: 8 }).map((_, i) => (
				<WidgetSkeleton key={i} />
			))}
		</div>
	);
}

export function SectionCards() {
	const { widgetOrder, onReorder, isLoading } = useWidgetOrder();

	if (isLoading) {
		return <SectionCardsSkeleton />;
	}

	return (
		<WidgetVisibilityProvider>
			<SortableWidgetGrid widgetOrder={widgetOrder} onReorder={onReorder}>
				{widgetOrder.map((widgetId) => {
					const WidgetComponent = WIDGET_COMPONENTS[widgetId];
					if (!WidgetComponent) return null;
					return <WidgetComponent key={widgetId} />;
				})}
			</SortableWidgetGrid>
		</WidgetVisibilityProvider>
	);
}
