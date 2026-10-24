import { type ReactNode, Suspense } from "react";
import { SectionCards } from "@/components/section-cards";
import { getRenderDashboardLayout, readDashboardWidget } from "./dashboard-reads";
import {
	type DashboardWidgetData,
	type DashboardWidgetSnapshot,
	isServerWidgetId,
	type ServerWidgetId,
} from "./dashboard-types";
import { ManagedEmployeesWidget } from "./managed-employees-widget";
import { ManagerTodayWidget } from "./manager-today-widget";
import { PendingApprovalsWidget } from "./pending-approvals-widget";
import { QuickStatsWidget } from "./quick-stats-widget";
import { RecentlyApprovedWidget } from "./recently-approved-widget";
import { TeamOverviewWidget } from "./team-overview-widget";
import { WidgetLoading } from "./widget-loading";
import { normalizeWidgetLayout, type WidgetId } from "./widget-registry";

async function WidgetSlot({
	id,
	snapshot,
}: {
	id: ServerWidgetId;
	snapshot: Promise<DashboardWidgetSnapshot<DashboardWidgetData[ServerWidgetId]>>;
}) {
	const initialSnapshot = await snapshot;
	switch (id) {
		case "manager-today":
			return (
				<ManagerTodayWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<DashboardWidgetData["manager-today"]>
					}
				/>
			);
		case "quick-stats":
			return (
				<QuickStatsWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<DashboardWidgetData["quick-stats"]>
					}
				/>
			);
		case "managed-employees":
			return (
				<ManagedEmployeesWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<DashboardWidgetData["managed-employees"]>
					}
				/>
			);
		case "team-overview":
			return (
				<TeamOverviewWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<DashboardWidgetData["team-overview"]>
					}
				/>
			);
		case "pending-approvals":
			return (
				<PendingApprovalsWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<DashboardWidgetData["pending-approvals"]>
					}
				/>
			);
		case "recently-approved":
			return (
				<RecentlyApprovedWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<DashboardWidgetData["recently-approved"]>
					}
				/>
			);
	}
}

export async function ServerSectionCards() {
	const bootstrap = await getRenderDashboardLayout();
	if (!bootstrap) return null;
	const layout = normalizeWidgetLayout(bootstrap.layout.settings.dashboardWidgetOrder);
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
