"use client";

import { useIsFetching } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { BirthdayRemindersWidget } from "@/components/dashboard/birthday-reminders-widget";
import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { HydrationWidget } from "@/components/dashboard/hydration-widget";
import { ManagedEmployeesWidget } from "@/components/dashboard/managed-employees-widget";
import { ManagerTodayWidget } from "@/components/dashboard/manager-today-widget";
import { PendingApprovalsWidget } from "@/components/dashboard/pending-approvals-widget";
import { PresenceStatusWidget } from "@/components/dashboard/presence-status-widget";
import { QuickStatsWidget } from "@/components/dashboard/quick-stats-widget";
import { RecentlyApprovedWidget } from "@/components/dashboard/recently-approved-widget";
import { SortableWidgetGrid } from "@/components/dashboard/sortable-widget-grid";
import { TeamOverviewWidget } from "@/components/dashboard/team-overview-widget";
import { UpcomingTimeOffWidget } from "@/components/dashboard/upcoming-time-off-widget";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";
import { VacationBalanceWidget } from "@/components/dashboard/vacation-balance-widget";
import { WhosOutTodayWidget } from "@/components/dashboard/whos-out-today-widget";
import type { WidgetId } from "@/components/dashboard/widget-registry";
import {
	useVisibleWidgets,
	WidgetVisibilityProvider,
} from "@/components/dashboard/widget-visibility-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Map of widget IDs to their component.
 * Widgets handle their own DashboardWidget wrapper internally.
 */
const WIDGET_COMPONENTS: Record<WidgetId, React.ComponentType> = {
	"manager-today": ManagerTodayWidget,
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
	"presence-status": PresenceStatusWidget,
};

const WIDGET_SKELETON_KEYS = Array.from({ length: 8 }, (_, index) => `widget-skeleton-${index}`);

function WidgetSkeleton() {
	return (
		<div className="mb-4 break-inside-avoid rounded-xl border bg-card p-6">
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
		<div className="columns-1 @xl/main:columns-2 @5xl/main:columns-3 gap-4 px-4 lg:px-6">
			{WIDGET_SKELETON_KEYS.map((key) => (
				<WidgetSkeleton key={key} />
			))}
		</div>
	);
}

function HiddenWidgetsEmptyState({ onReset }: { onReset: () => void }) {
	const { t } = useTranslate();

	return (
		<div className="mx-4 rounded-xl border border-dashed bg-card p-8 text-center lg:mx-6">
			<h2 className="font-semibold text-card-foreground text-lg">
				{t("dashboard.customize.empty-title", "All dashboard widgets are hidden")}
			</h2>
			<p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
				{t(
					"dashboard.customize.empty-description",
					"Use the dashboard customization icon to re-enable individual widgets, or reset the layout to show every widget again.",
				)}
			</p>
			<Button className="mt-4" onClick={onReset} variant="outline">
				{t("dashboard.customize.reset", "Reset layout")}
			</Button>
		</div>
	);
}

function DashboardWidgetLayout({
	visibleWidgetOrder,
	hiddenWidgets,
	onReorder,
	onVisibilityChange,
	resetOrder,
}: {
	visibleWidgetOrder: WidgetId[];
	hiddenWidgets: WidgetId[];
	onReorder: (newOrder: WidgetId[]) => void;
	onVisibilityChange: (widgetId: WidgetId, visible: boolean) => void;
	resetOrder: () => void;
}) {
	const renderedWidgets = useVisibleWidgets();
	const fetchingDashboardWidgets = useIsFetching({ queryKey: ["dashboard"] });
	const [hasCheckedRenderedWidgets, setHasCheckedRenderedWidgets] = useState(false);
	const visibleWidgetKey = visibleWidgetOrder.join("|");
	const hasConfiguredWidgets = visibleWidgetOrder.length > 0;
	const shouldShowEmptyState =
		!hasConfiguredWidgets ||
		(hasCheckedRenderedWidgets && fetchingDashboardWidgets === 0 && renderedWidgets.length === 0);

	useEffect(() => {
		if (!visibleWidgetKey) {
			setHasCheckedRenderedWidgets(true);
			return;
		}

		setHasCheckedRenderedWidgets(false);
		const frame = requestAnimationFrame(() => {
			setHasCheckedRenderedWidgets(true);
		});

		return () => {
			cancelAnimationFrame(frame);
		};
	}, [visibleWidgetKey]);

	return (
		<>
			<div className="mb-3 flex justify-end px-4 lg:px-6">
				<DashboardCustomizeMenu
					hiddenWidgets={hiddenWidgets}
					onReset={resetOrder}
					onVisibilityChange={onVisibilityChange}
				/>
			</div>
			{hasConfiguredWidgets ? (
				<SortableWidgetGrid widgetOrder={visibleWidgetOrder} onReorder={onReorder}>
					{visibleWidgetOrder.map((widgetId) => {
						const WidgetComponent = WIDGET_COMPONENTS[widgetId];
						if (!WidgetComponent) return null;
						return <WidgetComponent key={widgetId} />;
					})}
				</SortableWidgetGrid>
			) : null}
			{shouldShowEmptyState ? <HiddenWidgetsEmptyState onReset={resetOrder} /> : null}
		</>
	);
}

export function SectionCards() {
	const {
		visibleWidgetOrder,
		hiddenWidgets,
		onReorder,
		onVisibilityChange,
		resetOrder,
		isLoading,
	} = useWidgetOrder();

	if (isLoading) {
		return <SectionCardsSkeleton />;
	}

	return (
		<WidgetVisibilityProvider>
			<DashboardWidgetLayout
				hiddenWidgets={hiddenWidgets}
				onReorder={onReorder}
				onVisibilityChange={onVisibilityChange}
				resetOrder={resetOrder}
				visibleWidgetOrder={visibleWidgetOrder}
			/>
		</WidgetVisibilityProvider>
	);
}
