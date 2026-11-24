"use client";

import { IconArrowRight, IconCalendarCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
} from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import {
	type ManagerTodayMetricCounts,
	mapManagerTodaySummary,
} from "./manager-today-summary";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

type MetricItem = {
	label: string;
	value: number;
	/** The value as shown, such as a lower bound "3+"; the value itself when absent. */
	display?: string;
	/** Read to screen readers in place of `display` when the glyph alone says nothing ("—"). */
	srDisplay?: string;
	activeClass?: string;
};

const EMPTY_METRICS: ManagerTodayMetricCounts = {
	critical: 0,
	approvals: 0,
	clockIns: 0,
	risks: 0,
	allClear: true,
};

export function ManagerTodayWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<
		DashboardWidgetData["manager-today"]
	>;
} = {}) {
	const { t } = useTranslate();
	const managerTodayQuery = useDashboardWidget(
		"manager-today",
		initialSnapshot,
	);

	const role = managerTodayQuery.role;
	const isAuthorized = role === "admin" || role === "manager";
	const loading = managerTodayQuery.loading;
	const hasError =
		isAuthorized &&
		(Boolean(managerTodayQuery.error) ||
			Boolean(managerTodayQuery.data?.error) ||
			(!loading && !managerTodayQuery.data?.summary));
	const metrics = managerTodayQuery.data?.summary
		? mapManagerTodaySummary(managerTodayQuery.data.summary)
		: EMPTY_METRICS;

	if (!isAuthorized) {
		return null;
	}

	const metricItems: MetricItem[] = [
		{
			label: t("dashboard.manager-today.metric-critical", "Critical"),
			value: metrics.critical,
			activeClass:
				"border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100",
		},
		{
			label: t("dashboard.manager-today.metric-approvals", "Approvals"),
			value: metrics.approvals,
			// No count known at all: unavailable. An approval type failed to load or count: at least
			// this many wait (#1980).
			...(metrics.approvalsUnavailable
				? {
						display: t("dashboard.manager-today.metric-unavailable", "—"),
						srDisplay: t("dashboard.manager-today.metric-unavailable-label", "Unavailable"),
					}
				: metrics.approvalsAtLeast
					? {
							display: t("dashboard.manager-today.metric-at-least", "{count}+", {
								count: metrics.approvals,
							}),
						}
					: {}),
		},
		{
			label: t("dashboard.manager-today.metric-clock-ins", "Clock-ins"),
			value: metrics.clockIns,
			activeClass:
				"border-blue-300/70 bg-blue-50 text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-100",
		},
		{
			label: t("dashboard.manager-today.metric-risks", "Risks"),
			value: metrics.risks,
			activeClass:
				"border-orange-300/70 bg-orange-50 text-orange-950 dark:border-orange-900/50 dark:bg-orange-950/25 dark:text-orange-100",
		},
	];

	return (
		<DashboardWidget id="manager-today">
			<WidgetCard
				title={t("dashboard.manager-today.title", "Manager Today")}
				description={t(
					"dashboard.manager-today.description",
					"Review today before small issues affect payroll or coverage.",
				)}
				icon={
					<IconCalendarCheck
						className="size-4 text-blue-500"
						aria-hidden="true"
					/>
				}
				loading={loading}
				refreshing={managerTodayQuery.refreshing}
				onRefresh={managerTodayQuery.refetch}
				action={
					<Button variant="ghost" size="sm" asChild>
						<Link href="/today">
							{t("dashboard.manager-today.open", "Open Brief")}
							<IconArrowRight className="ml-1 size-3" aria-hidden="true" />
						</Link>
					</Button>
				}
			>
				<div className="space-y-4">
					{hasError ? (
						<WidgetReadError
							title={t("dashboard.manager-today.title", "Manager Today")}
							message={t(
								"dashboard.manager-today.error",
								"Failed to load manager briefing counts.",
							)}
							retry={managerTodayQuery.refetch}
							refreshing={managerTodayQuery.refreshing}
						/>
					) : null}

					{!hasError && (
						<div
							className="grid grid-cols-2 gap-2 @2xl/widget:grid-cols-4"
							data-testid="manager-today-metrics"
						>
							{metricItems.map((item) => (
								<Link
									href="/today"
									key={item.label}
									className={cn(
										"min-w-0 rounded-lg border border-transparent px-3 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
										item.value > 0 && item.activeClass,
									)}
								>
									<div className="text-xl font-semibold tabular-nums leading-none">
										{item.srDisplay ? (
											<>
												<span aria-hidden="true">{item.display}</span>
												<span className="sr-only">{item.srDisplay}</span>
											</>
										) : (
											(item.display ?? item.value)
										)}
									</div>
									<div className="mt-1 text-sm font-medium text-muted-foreground break-words hyphens-auto">
										{item.label}
									</div>
								</Link>
							))}
						</div>
					)}

					{!hasError && metrics.allClear ? (
						<p className="rounded-lg border border-blue-200/70 bg-blue-50/60 px-3 py-2 text-sm text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
							{t(
								"dashboard.manager-today.all-clear",
								"No manager action is flagged right now.",
							)}
						</p>
					) : null}
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
