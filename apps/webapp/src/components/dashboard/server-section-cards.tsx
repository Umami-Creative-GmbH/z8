import { type ReactNode, Suspense } from "react";
import { SectionCards } from "@/components/section-cards";
import {
	getRenderDashboardLayout,
	readDashboardWidget,
} from "./dashboard-reads";
import {
	type DashboardWidgetData,
	type DashboardWidgetSnapshot,
	isServerWidgetId,
	type ServerWidgetId,
} from "./dashboard-types";
import { ManagerTodayWidget } from "./manager-today-widget";
import { QuickStatsWidget } from "./quick-stats-widget";
import { WidgetLoading } from "./widget-loading";
import { normalizeWidgetLayout, type WidgetId } from "./widget-registry";

async function WidgetSlot({
	id,
	snapshot,
}: {
	id: ServerWidgetId;
	snapshot: Promise<
		DashboardWidgetSnapshot<DashboardWidgetData[ServerWidgetId]>
	>;
}) {
	const initialSnapshot = await snapshot;
	return id === "manager-today" ? (
		<ManagerTodayWidget
			initialSnapshot={
				initialSnapshot as DashboardWidgetSnapshot<
					DashboardWidgetData["manager-today"]
				>
			}
		/>
	) : (
		<QuickStatsWidget
			initialSnapshot={
				initialSnapshot as DashboardWidgetSnapshot<
					DashboardWidgetData["quick-stats"]
				>
			}
		/>
	);
}

export async function ServerSectionCards() {
	const bootstrap = await getRenderDashboardLayout();
	if (!bootstrap) return null;
	const layout = normalizeWidgetLayout(
		bootstrap.layout.settings.dashboardWidgetOrder,
	);
	const slots: Partial<Record<WidgetId, ReactNode>> = {};
	for (const id of layout.order) {
		if (layout.hidden.includes(id) || !isServerWidgetId(id)) continue;
		// Start each authorized read now. A slow region never becomes another's prerequisite.
		const snapshot = readDashboardWidget(id, bootstrap.subject);
		slots[id] = (
			<Suspense fallback={<WidgetLoading id={id} />}>
				<WidgetSlot id={id} snapshot={snapshot} />
			</Suspense>
		);
	}
	return <SectionCards initialLayout={bootstrap.layout} widgetSlots={slots} />;
}
