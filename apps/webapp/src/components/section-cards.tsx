"use client";

import { useIsFetching } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
	type ReactNode,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { CoveringForWidget } from "@/components/dashboard/covering-for-widget";
import {
	dashboardRegionWidgets,
	usesDashboardRegions,
} from "@/components/dashboard/dashboard-regions";
import type { DashboardLayoutBootstrap } from "@/components/dashboard/dashboard-types";
import { DeferredDashboardWidget } from "@/components/dashboard/deferred-dashboard-widget";
import { ManagedEmployeesWidget } from "@/components/dashboard/managed-employees-widget";
import { ManagerTodayWidget } from "@/components/dashboard/manager-today-widget";
import { PendingApprovalsWidget } from "@/components/dashboard/pending-approvals-widget";
import { PersonalDay } from "@/components/dashboard/personal-day";
import { PresenceStatusWidget } from "@/components/dashboard/presence-status-widget";
import { QuickStatsWidget } from "@/components/dashboard/quick-stats-widget";
import { RecentlyApprovedWidget } from "@/components/dashboard/recently-approved-widget";
import { SortableWidgetGrid } from "@/components/dashboard/sortable-widget-grid";
import { TeamOverviewWidget } from "@/components/dashboard/team-overview-widget";
import { UpcomingShiftsWidget } from "@/components/dashboard/upcoming-shifts-widget";
import { UpcomingTimeOffWidget } from "@/components/dashboard/upcoming-time-off-widget";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";
import { VacationBalanceWidget } from "@/components/dashboard/vacation-balance-widget";
import { WhosOutTodayWidget } from "@/components/dashboard/whos-out-today-widget";
import { WidgetCardVariantContext } from "@/components/dashboard/widget-card";
import type { WidgetId } from "@/components/dashboard/widget-registry";
import {
	useVisibleWidgets,
	WidgetVisibilityProvider,
} from "@/components/dashboard/widget-visibility-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Map of widget IDs to their component.
 * Widgets handle their own DashboardWidget wrapper internally.
 */
function BirthdayRemindersFallback() {
	return <DeferredDashboardWidget id="birthday-reminders" />;
}
function HydrationFallback() {
	return <DeferredDashboardWidget id="hydration" />;
}

const WIDGET_COMPONENTS: Record<WidgetId, React.ComponentType> = {
	"manager-today": ManagerTodayWidget,
	"managed-employees": ManagedEmployeesWidget,
	"pending-approvals": PendingApprovalsWidget,
	"team-overview": TeamOverviewWidget,
	"quick-stats": QuickStatsWidget,
	"upcoming-shifts": UpcomingShiftsWidget,
	"covering-for": CoveringForWidget,
	"whos-out-today": WhosOutTodayWidget,
	"upcoming-time-off": UpcomingTimeOffWidget,
	"recently-approved": RecentlyApprovedWidget,
	"birthday-reminders": BirthdayRemindersFallback,
	hydration: HydrationFallback,
	"vacation-balance": VacationBalanceWidget,
	"presence-status": PresenceStatusWidget,
};

const WIDGET_SKELETON_KEYS = Array.from(
	{ length: 8 },
	(_, index) => `widget-skeleton-${index}`,
);

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

function useHasHydrated() {
	return useSyncExternalStore(
		subscribeToHydration,
		getHydratedSnapshot,
		getServerHydrationSnapshot,
	);
}

function WidgetSkeleton() {
	return (
		<div className="mb-4 break-inside-avoid rounded-xl border bg-card p-6">
			<div className="flex items-center justify-between mb-4">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="size-4 rounded-full" />
			</div>
			<div className="space-y-3">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-4 w-1/2" />
			</div>
		</div>
	);
}

export function SectionCardsSkeleton({
	"aria-hidden": ariaHidden,
}: {
	"aria-hidden"?: "true" | "false";
} = {}) {
	return (
		<div
			aria-hidden={ariaHidden}
			className="columns-1 @xl/main:columns-2 @5xl/main:columns-3 @[110rem]/main:columns-4 gap-4"
		>
			{WIDGET_SKELETON_KEYS.map((key) => (
				<WidgetSkeleton key={key} />
			))}
		</div>
	);
}

function HiddenWidgetsEmptyState({ onReset }: { onReset: () => void }) {
	const { t } = useTranslate();

	return (
		<div className="rounded-xl border border-dashed bg-card p-8 text-center">
			<h2 className="font-semibold text-card-foreground text-lg">
				{t(
					"dashboard.customize.empty-title",
					"All dashboard widgets are hidden",
				)}
			</h2>
			<p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
				{t(
					"dashboard.customize.empty-description-defaults",
					"Use the dashboard customization icon to re-enable individual widgets, or reset the layout to restore your default widgets.",
				)}
			</p>
			<Button className="mt-4" onClick={onReset} variant="outline">
				{t("dashboard.customize.reset", "Reset layout")}
			</Button>
		</div>
	);
}

/**
 * One bordered surface holding several widgets as flush segments. Widgets arrive through
 * `display: contents` slot wrappers, so sibling selectors cannot draw the dividers: each
 * segment draws a leading border and overlaps its predecessor by 1px, and the surface
 * clips the first segment's border.
 */
const SHARED_SURFACE =
	"min-w-0 overflow-hidden rounded-xl border bg-card [&_[data-widget-id]]:mb-0 [&_[data-widget-id]]:-mt-px [&_[data-widget-id]]:border-t [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:shadow-none";

function DashboardRegionLayout({
	visibleWidgetOrder,
	renderWidget,
	personalDaySlot,
}: {
	visibleWidgetOrder: WidgetId[];
	renderWidget: (id: WidgetId) => ReactNode;
	personalDaySlot?: ReactNode;
}) {
	const { t } = useTranslate();
	const summary = dashboardRegionWidgets(visibleWidgetOrder, "summary");
	const attention = dashboardRegionWidgets(visibleWidgetOrder, "attention");
	const records = dashboardRegionWidgets(visibleWidgetOrder, "records");
	const personal = dashboardRegionWidgets(visibleWidgetOrder, "personal");
	const showPersonalDay = visibleWidgetOrder.includes("quick-stats");
	const hasPersonalColumn = showPersonalDay || personal.length > 0;

	return (
		<>
			{summary.length > 0 ? (
				<WidgetCardVariantContext value="strip">
					<section
						aria-label={t("dashboard.refresh.summary", "Summary")}
						data-dashboard-region="summary"
						className={cn(
							SHARED_SURFACE,
							"grid",
							summary.length > 1 &&
								"@4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] @4xl/main:[&_[data-widget-id]]:mt-0 @4xl/main:[&_[data-widget-id]]:-ml-px @4xl/main:[&_[data-widget-id]]:border-t-0 @4xl/main:[&_[data-widget-id]]:border-l",
						)}
					>
						{summary.map(renderWidget)}
					</section>
				</WidgetCardVariantContext>
			) : null}
			{/*
			 * Balanced columns: widget heights vary by role and data, so fixed region
			 * columns leave large gaps. The browser balances the columns instead.
			 * Regions are `display: contents` so they keep their identity without
			 * becoming column items; DashboardWidget already avoids column breaks.
			 */}
			<div className="min-w-0 gap-4 @3xl/main:columns-2 @[96rem]/main:columns-3">
				{attention.length > 0 ? (
					<section
						aria-label={t("dashboard.refresh.attention", "Today at a glance")}
						data-dashboard-region="attention"
						className={cn(SHARED_SURFACE, "mb-4 break-inside-avoid")}
					>
						{attention.map(renderWidget)}
					</section>
				) : null}
				{records.length > 0 ? (
					<div data-dashboard-region="records" className="contents">
						{records.map(renderWidget)}
					</div>
				) : null}
				{hasPersonalColumn ? (
					<div data-dashboard-region="personal" className="contents">
						{showPersonalDay ? (
							<div className="mb-4 break-inside-avoid empty:hidden">
								{personalDaySlot ?? <PersonalDay />}
							</div>
						) : null}
						{personal.map(renderWidget)}
					</div>
				) : null}
			</div>
		</>
	);
}

function DashboardWidgetLayout({
	visibleWidgetOrder,
	onReorder,
	resetOrder,
	widgetSlots,
	personalDaySlot,
}: {
	visibleWidgetOrder: WidgetId[];
	onReorder: (newOrder: WidgetId[]) => void;
	resetOrder: () => void;
	widgetSlots?: Partial<Record<WidgetId, ReactNode>>;
	personalDaySlot?: ReactNode;
}) {
	const renderedWidgets = useVisibleWidgets();
	const fetchingDashboardWidgets = useIsFetching({ queryKey: ["dashboard"] });
	const visibleWidgetKey = visibleWidgetOrder.join("|");
	const [hasCheckedRenderedWidgets, setHasCheckedRenderedWidgets] = useState(
		!visibleWidgetKey,
	);
	const [checkedWidgetKey, setCheckedWidgetKey] = useState(visibleWidgetKey);

	if (checkedWidgetKey !== visibleWidgetKey) {
		setCheckedWidgetKey(visibleWidgetKey);
		setHasCheckedRenderedWidgets(!visibleWidgetKey);
	}

	const hasConfiguredWidgets = visibleWidgetOrder.length > 0;
	const shouldShowEmptyState =
		!hasConfiguredWidgets ||
		(hasCheckedRenderedWidgets &&
			fetchingDashboardWidgets === 0 &&
			renderedWidgets.length === 0);

	useEffect(() => {
		if (!visibleWidgetKey) {
			return;
		}

		const frame = requestAnimationFrame(() => {
			setHasCheckedRenderedWidgets(true);
		});

		return () => {
			cancelAnimationFrame(frame);
		};
	}, [visibleWidgetKey]);

	const renderWidget = (widgetId: WidgetId) => {
		if (widgetSlots?.[widgetId])
			return (
				<div key={widgetId} className="contents">
					{widgetSlots[widgetId]}
				</div>
			);
		const WidgetComponent = WIDGET_COMPONENTS[widgetId];
		return <WidgetComponent key={widgetId} />;
	};
	const grouped = usesDashboardRegions(visibleWidgetOrder);

	return (
		<>
			{hasConfiguredWidgets ? (
				<SortableWidgetGrid
					widgetOrder={visibleWidgetOrder}
					onReorder={onReorder}
					className={grouped ? "space-y-6" : undefined}
				>
					{grouped ? (
						<DashboardRegionLayout
							visibleWidgetOrder={visibleWidgetOrder}
							renderWidget={renderWidget}
							personalDaySlot={personalDaySlot}
						/>
					) : (
						visibleWidgetOrder.map(renderWidget)
					)}
				</SortableWidgetGrid>
			) : null}
			{shouldShowEmptyState ? (
				<HiddenWidgetsEmptyState onReset={resetOrder} />
			) : null}
		</>
	);
}

export function SectionCards({
	initialLayout,
	widgetSlots,
	personalDaySlot,
}: {
	initialLayout?: DashboardLayoutBootstrap;
	widgetSlots?: Partial<Record<WidgetId, ReactNode>>;
	personalDaySlot?: ReactNode;
} = {}) {
	const { visibleWidgetOrder, onReorder, resetOrder, isLoading } =
		useWidgetOrder(initialLayout);
	const hasHydrated = useHasHydrated();

	if ((!initialLayout && !hasHydrated) || isLoading) {
		return <SectionCardsSkeleton />;
	}

	return (
		<WidgetVisibilityProvider>
			<DashboardWidgetLayout
				onReorder={onReorder}
				resetOrder={resetOrder}
				visibleWidgetOrder={visibleWidgetOrder}
				personalDaySlot={personalDaySlot}
				widgetSlots={widgetSlots}
			/>
		</WidgetVisibilityProvider>
	);
}
