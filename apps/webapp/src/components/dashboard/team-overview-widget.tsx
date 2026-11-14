"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
} from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

export function TeamOverviewWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<
		DashboardWidgetData["team-overview"]
	>;
} = {}) {
	const { t } = useTranslate();
	const {
		data: stats,
		loading,
		refreshing,
		refetch,
		role,
		error,
	} = useDashboardWidget("team-overview", initialSnapshot);
	if (role !== "admin" && role !== "manager") return null;
	return (
		<DashboardWidget id="team-overview">
			<WidgetCard
				title={t("dashboard.team-overview.title", "Organization")}
				description=""
				icon={<IconBuilding className="size-4" aria-hidden="true" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{error ? (
					<WidgetReadError
						title={t("dashboard.team-overview.title", "Organization")}
						message={error}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : stats ? (
					<div className="space-y-4">
						<div>
							<p className="text-2xl font-semibold tabular-nums">
								{stats.currentEmployees}
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{t(
									"dashboard.team-overview.current-employees",
									"Current employees",
								)}
							</p>
						</div>
						<dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
							<div>
								<dt className="text-muted-foreground">
									{t("dashboard.team-overview.teams", "Teams")}
								</dt>
								<dd className="tabular-nums">{stats.teamsCount}</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">
									{t("dashboard.team-overview.avg-hours", "Avg. Hours")}
								</dt>
								<dd className="tabular-nums">
									{stats.avgWorkHours}
									{t("dashboard.team-overview.per-week", "/week")}
								</dd>
							</div>
						</dl>
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-primary dark:text-foreground dark:underline">
							<Link
								className="inline-flex min-h-9 items-center underline-offset-4 hover:underline"
								href="/settings/teams"
							>
								{t("dashboard.team-overview.teams-button", "Teams")}
							</Link>
							<Link
								className="inline-flex min-h-9 items-center underline-offset-4 hover:underline"
								href="/settings/employees"
							>
								{t("dashboard.team-overview.employees-button", "Employees")}
							</Link>
						</div>
					</div>
				) : null}
			</WidgetCard>
		</DashboardWidget>
	);
}
