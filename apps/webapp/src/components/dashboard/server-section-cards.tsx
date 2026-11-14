import { unstable_rethrow } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { readTimeKpis } from "@/app/[locale]/(app)/time-tracking/read-time-kpis";
import { SectionCards } from "@/components/section-cards";
import { getRenderAuthContext } from "@/lib/auth/render-context";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import type { TimeKpiRead } from "@/lib/time-tracking/time-kpis";
import { CoveringForWidget } from "./covering-for-widget";
import { DashboardHeading } from "./dashboard-heading";
import {
	getRenderDashboardLayout,
	readDashboardWidget,
} from "./dashboard-reads";
import type { DashboardSubject } from "./dashboard-types";
import {
	type DashboardWidgetData,
	type DashboardWidgetSnapshot,
	isServerWidgetId,
	type ServerWidgetId,
} from "./dashboard-types";
import { DeferredDashboardWidget } from "./deferred-dashboard-widget";
import { PersonalDay } from "./personal-day";

async function PersonalDaySlot({ subject }: { subject: DashboardSubject }) {
	if (!subject.employee) return null;
	let timeKpis: TimeKpiRead | null = null;
	try {
		timeKpis = await readTimeKpis(
			{
				organizationId: subject.organizationId,
				employeeId: subject.employee.id,
			},
			subject.preferences?.timezone ?? "UTC",
			subject.preferences?.weekStartDay ?? "monday",
		);
	} catch (error) {
		unstable_rethrow(error);
	}
	return <PersonalDay timeKpis={timeKpis} />;
}

import { ManagedEmployeesWidget } from "./managed-employees-widget";
import { ManagerTodayWidget } from "./manager-today-widget";
import { PendingApprovalsWidget } from "./pending-approvals-widget";
import { PresenceStatusWidget } from "./presence-status-widget";
import { QuickStatsWidget } from "./quick-stats-widget";
import { RecentlyApprovedWidget } from "./recently-approved-widget";
import { TeamOverviewWidget } from "./team-overview-widget";
import { UpcomingShiftsWidget } from "./upcoming-shifts-widget";
import { UpcomingTimeOffWidget } from "./upcoming-time-off-widget";
import { VacationBalanceWidget } from "./vacation-balance-widget";
import { WhosOutTodayWidget } from "./whos-out-today-widget";
import { WidgetLoading } from "./widget-loading";
import {
	isDeferredWidgetId,
	normalizeWidgetLayout,
	type WidgetId,
} from "./widget-registry";

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
	switch (id) {
		case "birthday-reminders":
		case "hydration":
			return <DeferredDashboardWidget id={id} />;
		case "vacation-balance":
			return (
				<VacationBalanceWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["vacation-balance"]
						>
					}
				/>
			);
		case "presence-status":
			return (
				<PresenceStatusWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["presence-status"]
						>
					}
				/>
			);

		case "upcoming-shifts":
			return (
				<UpcomingShiftsWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["upcoming-shifts"]
						>
					}
				/>
			);
		case "covering-for":
			return (
				<CoveringForWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["covering-for"]
						>
					}
				/>
			);
		case "whos-out-today":
			return (
				<WhosOutTodayWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["whos-out-today"]
						>
					}
				/>
			);
		case "upcoming-time-off":
			return (
				<UpcomingTimeOffWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["upcoming-time-off"]
						>
					}
				/>
			);

		case "manager-today":
			return (
				<ManagerTodayWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["manager-today"]
						>
					}
				/>
			);
		case "quick-stats":
			return (
				<QuickStatsWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["quick-stats"]
						>
					}
				/>
			);
		case "managed-employees":
			return (
				<ManagedEmployeesWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["managed-employees"]
						>
					}
				/>
			);
		case "team-overview":
			return (
				<TeamOverviewWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["team-overview"]
						>
					}
				/>
			);
		case "pending-approvals":
			return (
				<PendingApprovalsWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["pending-approvals"]
						>
					}
				/>
			);
		case "recently-approved":
			return (
				<RecentlyApprovedWidget
					initialSnapshot={
						initialSnapshot as DashboardWidgetSnapshot<
							DashboardWidgetData["recently-approved"]
						>
					}
				/>
			);
	}
}

export async function ServerSectionCards() {
	const bootstrap = await getRenderDashboardLayout();
	if (!bootstrap) return null;
	const layout = normalizeWidgetLayout(
		bootstrap.layout.settings.dashboardWidgetOrder,
		bootstrap.layout.availableWidgetIds,
	);
	const slots: Partial<Record<WidgetId, ReactNode>> = {};
	const available = bootstrap.layout.availableWidgetIds
		? new Set(bootstrap.layout.availableWidgetIds)
		: null;
	const hidden = new Set(layout.hidden);
	for (const id of layout.order) {
		if (
			hidden.has(id) ||
			(available && !available.has(id)) ||
			!isServerWidgetId(id)
		)
			continue;
		if (isDeferredWidgetId(id)) {
			slots[id] = <DeferredDashboardWidget id={id} />;
			continue;
		}
		// Start each authorized read now. A slow region never becomes another's prerequisite.
		const snapshot = readDashboardWidget(id, bootstrap.subject);
		slots[id] = (
			<Suspense fallback={<WidgetLoading id={id} />}>
				<WidgetSlot id={id} snapshot={snapshot} />
			</Suspense>
		);
	}
	const context = await getRenderAuthContext();
	return (
		<>
			<DashboardHeading
				name={context?.user.name ?? null}
				date={plainDateAt(
					systemClock.nowInstant(),
					bootstrap.subject.preferences?.timezone ?? "UTC",
				).toString()}
			/>
			<SectionCards
				initialLayout={bootstrap.layout}
				widgetSlots={slots}
				personalDaySlot={
					!hidden.has("quick-stats") && bootstrap.subject.employee ? (
						<Suspense fallback={<PersonalDay />}>
							<PersonalDaySlot subject={bootstrap.subject} />
						</Suspense>
					) : undefined
				}
			/>
		</>
	);
}
