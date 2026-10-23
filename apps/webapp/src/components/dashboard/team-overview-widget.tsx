"use client";

import {
	IconBuilding,
	IconClock,
	IconUserCheck,
	IconUsers,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { getTeamOverviewStats } from "@/components/dashboard/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

interface TeamStats {
	currentEmployees: number;
	teamsCount: number;
	avgWorkHours: number;
}

type EmployeeRole = "admin" | "manager" | "employee";

function StatCard({
	icon: Icon,
	iconBg,
	label,
	value,
	suffix,
}: {
	icon: React.ElementType;
	iconBg: string;
	label: string;
	value: string | number;
	suffix?: string;
}) {
	return (
		<div className="flex items-center gap-3 rounded-xl border bg-card p-3">
			<div className={cn("flex items-center justify-center rounded-lg p-2", iconBg)}>
				<Icon className="size-4 text-white" />
			</div>
			<div>
				<p className="text-xs text-muted-foreground">{label}</p>
				<p className="font-semibold">
					{value}
					{suffix && (
						<span className="text-xs font-normal text-muted-foreground ml-0.5">{suffix}</span>
					)}
				</p>
			</div>
		</div>
	);
}

export function TeamOverviewWidget() {
	const { t } = useTranslate();
	const teamOverviewQuery = useQuery({
		queryKey: ["dashboard", "team-overview"],
		queryFn: async () => {
			const current = await getCurrentEmployee();
			if (!current) {
				return { role: null as EmployeeRole | null, stats: null as TeamStats | null };
			}

			if (current.role !== "admin" && current.role !== "manager") {
				return { role: current.role, stats: null as TeamStats | null };
			}

			const result = await getTeamOverviewStats();
			if (!result.success || !result.data) {
				throw new Error(t("dashboard.team-overview.error", "Failed to load team statistics"));
			}

			return { role: current.role, stats: result.data };
		},
	});

	const role = teamOverviewQuery.data?.role ?? null;
	const stats = teamOverviewQuery.data?.stats ?? null;
	const loading = teamOverviewQuery.isLoading;
	const refreshing = teamOverviewQuery.isFetching && !teamOverviewQuery.isLoading;

	const refetch = () => {
		teamOverviewQuery.refetch();
	};

	if (!loading && (!role || (role !== "admin" && role !== "manager"))) {
		return null;
	}

	if (!loading && !stats) return null;

	return (
		<DashboardWidget id="team-overview">
			<WidgetCard
				title={t("dashboard.team-overview.title", "Organization")}
				description={t("dashboard.team-overview.description", "Team statistics at a glance")}
				icon={<IconBuilding className="size-4 text-teal-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{stats && (
					<div className="space-y-4">
						{/* Current roster - Featured (#1438): former employees don't count */}
						<div className="flex items-center gap-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 p-4 dark:from-emerald-950/30 dark:to-teal-950/30">
							<div className="flex size-16 shrink-0 items-center justify-center rounded-full border-[5px] border-emerald-500">
								<span className="text-lg font-bold">{stats.currentEmployees}</span>
							</div>

							<div className="flex-1">
								<div className="flex items-center gap-2">
									<IconUserCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
									<span className="font-medium text-emerald-700 dark:text-emerald-300">
										{t("dashboard.team-overview.current-employees", "Current employees")}
									</span>
								</div>
								<p className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">
									{t(
										"dashboard.team-overview.current-employees-description",
										"Everyone who works here now",
									)}
								</p>
							</div>
						</div>

						{/* Stats Grid */}
						<div className="grid grid-cols-2 gap-3">
							<StatCard
								icon={IconUsersGroup}
								iconBg="bg-violet-500"
								label={t("dashboard.team-overview.teams", "Teams")}
								value={stats.teamsCount}
							/>
							<StatCard
								icon={IconClock}
								iconBg="bg-blue-500"
								label={t("dashboard.team-overview.avg-hours", "Avg. Hours")}
								value={stats.avgWorkHours}
								suffix={t("dashboard.team-overview.per-week", "/week")}
							/>
						</div>

						{/* Quick Actions */}
						<div className="grid grid-cols-2 gap-2">
							<Button variant="outline" size="sm" className="group" asChild>
								<Link href="/settings/teams">
									<IconUsers className="mr-2 size-4 transition-transform group-hover:scale-110" />
									{t("dashboard.team-overview.teams-button", "Teams")}
								</Link>
							</Button>
							<Button variant="outline" size="sm" className="group" asChild>
								<Link href="/settings/employees">
									<IconUserCheck className="mr-2 size-4 transition-transform group-hover:scale-110" />
									{t("dashboard.team-overview.employees-button", "Employees")}
								</Link>
							</Button>
						</div>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
