"use client";

import {
	IconBuilding,
	IconClock,
	IconUserCheck,
	IconUsers,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { getTeamOverviewStats } from "@/components/dashboard/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

interface TeamStats {
	totalEmployees: number;
	activeEmployees: number;
	teamsCount: number;
	avgWorkHours: number;
}

type EmployeeRole = "admin" | "manager" | "employee";

function CircularProgress({
	progress,
	size = 64,
	strokeWidth = 5,
	children,
}: {
	progress: number;
	size?: number;
	strokeWidth?: number;
	children: React.ReactNode;
}) {
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;

	return (
		<div className="relative inline-flex items-center justify-center">
			<svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={strokeWidth}
					className="stroke-muted"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					className="stroke-emerald-500 transition-all duration-500 ease-out"
					style={{
						strokeDasharray: circumference,
						strokeDashoffset,
					}}
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
		</div>
	);
}

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
	const [stats, setStats] = useState<TeamStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [role, setRole] = useState<EmployeeRole | null>(null);

	const loadData = useCallback(
		async (isRefresh = false) => {
			if (isRefresh) {
				setRefreshing(true);
			}

			const current = await getCurrentEmployee();
			if (!current) {
				setLoading(false);
				setRefreshing(false);
				return;
			}

			setRole(current.role);

			if (current.role !== "admin" && current.role !== "manager") {
				setLoading(false);
				setRefreshing(false);
				return;
			}

			const result = await getTeamOverviewStats();
			if (result.success && result.data) {
				setStats(result.data);
			} else {
				toast.error(t("dashboard.team-overview.error", "Failed to load team statistics"));
			}

			setLoading(false);
			setRefreshing(false);
		},
		[t],
	);

	useEffect(() => {
		loadData(false);
	}, [loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	if (!loading && (!role || (role !== "admin" && role !== "manager"))) {
		return null;
	}

	if (!loading && !stats) return null;

	const activePercentage = stats ? (stats.activeEmployees / stats.totalEmployees) * 100 : 0;

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
						{/* Active Employees - Featured */}
						<div className="flex items-center gap-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 p-4 dark:from-emerald-950/30 dark:to-teal-950/30">
							<CircularProgress progress={activePercentage}>
								<span className="text-lg font-bold">{stats.activeEmployees}</span>
							</CircularProgress>

							<div className="flex-1">
								<div className="flex items-center gap-2">
									<IconUserCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
									<span className="font-medium text-emerald-700 dark:text-emerald-300">
										{t("dashboard.team-overview.active-employees", "Active Employees")}
									</span>
								</div>
								<p className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">
									{t(
										"dashboard.team-overview.active-count",
										"{active} of {total} employees ({percent}%)",
										{
											active: stats.activeEmployees,
											total: stats.totalEmployees,
											percent: activePercentage.toFixed(0),
										},
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
