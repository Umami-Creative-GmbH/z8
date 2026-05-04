"use client";

import { IconArrowRight, IconCalendarCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { getManagerTodaySummary } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { mapManagerTodaySummary, type ManagerTodayMetricCounts } from "./manager-today-summary";
import { WidgetCard } from "./widget-card";
export {
	mapManagerTodaySummary,
	type ManagerTodayBriefingSummary,
	type ManagerTodayMetricCounts,
} from "./manager-today-summary";

type EmployeeRole = "admin" | "manager" | "employee";
type MetricItem = {
	label: string;
	value: number;
	activeClass?: string;
};

const EMPTY_METRICS: ManagerTodayMetricCounts = {
	critical: 0,
	approvals: 0,
	clockIns: 0,
	risks: 0,
	allClear: true,
};

export function ManagerTodayWidget() {
	const { t } = useTranslate();
	const managerTodayQuery = useQuery({
		queryKey: ["dashboard", "manager-today", "summary"],
		queryFn: getManagerTodaySummary,
	});

	const role = (managerTodayQuery.data?.role ?? null) as EmployeeRole | null;
	const isAuthorized = role === "admin" || role === "manager";
	const loading = managerTodayQuery.isLoading;
	const hasError =
		isAuthorized &&
		(managerTodayQuery.isError ||
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
				icon={<IconCalendarCheck className="size-4 text-blue-500" aria-hidden="true" />}
				loading={loading}
				action={
					<Button variant="default" size="sm" asChild>
						<Link href="/today">
							{t("dashboard.manager-today.open", "Open Brief")}
							<IconArrowRight className="ml-1 size-3" aria-hidden="true" />
						</Link>
					</Button>
				}
			>
				<div className="space-y-4">
					{hasError ? (
						<p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							{t(
								"dashboard.manager-today.error",
								"Failed to load manager briefing counts.",
							)}
						</p>
					) : null}

					<div className="grid grid-cols-2 gap-2" data-testid="manager-today-metrics">
						{metricItems.map((item) => (
							<div
								key={item.label}
								className={cn(
									"rounded-lg border bg-muted/25 px-3 py-2",
									item.value > 0 && item.activeClass,
								)}
							>
								<div className="text-2xl font-semibold tabular-nums leading-none">
									{item.value}
								</div>
								<div className="mt-1 text-xs font-medium text-muted-foreground">{item.label}</div>
							</div>
						))}
					</div>

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
