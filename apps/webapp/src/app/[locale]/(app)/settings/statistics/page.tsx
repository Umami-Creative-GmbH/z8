import {
	IconCalendarStats,
	IconChartBar,
	IconClock,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import type { ManagerStatisticsReadView, OrganizationStats } from "./actions";
import { getManagerStatisticsReadView, getOrganizationStats } from "./actions";

interface StatCardProps {
	title: string;
	value: number | string;
	description?: string;
	icon: React.ReactNode;
	trend?: {
		value: number;
		label: string;
		positive?: boolean;
	};
}

function StatCard({ title, value, description, icon, trend }: StatCardProps) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
				<div className="text-muted-foreground">{icon}</div>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-bold">{value.toLocaleString()}</div>
				{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
				{trend && (
					<p
						className={`mt-1 text-xs ${trend.positive ? "text-green-600" : trend.positive === false ? "text-red-600" : "text-muted-foreground"}`}
					>
						{trend.positive !== undefined && (trend.positive ? "+" : "")}
						{trend.value.toLocaleString()} {trend.label}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

async function StatisticsContent() {
	await connection();

	const [settingsRouteContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		redirect("/settings");
	}

	const canViewOrgWideStatistics = accessTier === "orgAdmin";
	const statsResult = await (canViewOrgWideStatistics
		? getOrganizationStats()
		: getManagerStatisticsReadView());

	if (!statsResult.success) {
		return (
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">{t("settings.statistics.title", "Statistics")}</h1>
					<p className="text-muted-foreground">
						{canViewOrgWideStatistics
							? t(
								"settings.statistics.description",
								"View statistics and metrics about your instance",
							)
							: t(
								"settings.statistics.managerDescription",
								"Review read-only analytics for the teams you manage.",
							)}
					</p>
				</div>
				<Card className="border-destructive">
					<CardContent className="pt-6">
						<p className="text-destructive">
							{t("settings.statistics.loadError", "Failed to load statistics")}: {statsResult.error}
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const stats = statsResult.data as OrganizationStats | ManagerStatisticsReadView;
	const timeEntryChange = stats.timeEntriesThisMonth - stats.timeEntriesLastMonth;
	const lastUpdated = DateTime.fromISO(stats.fetchedAt).toLocaleString(DateTime.DATETIME_SHORT);

	const orgStats = canViewOrgWideStatistics ? (stats as OrganizationStats) : null;

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">{t("settings.statistics.title", "Statistics")}</h1>
					<p className="text-muted-foreground">
						{canViewOrgWideStatistics
							? t(
								"settings.statistics.description",
								"View statistics and metrics about your instance",
							)
							: t(
								"settings.statistics.managerDescription",
								"Review read-only analytics for the teams you manage.",
							)}
					</p>
				</div>
				<p className="text-xs text-muted-foreground">
					{t("settings.statistics.lastUpdated", "Last updated")}: {lastUpdated}
				</p>
			</div>

			<section>
				<h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
					<IconUsers className="size-5" />
					{canViewOrgWideStatistics
						? t("settings.statistics.sections.coreCounts", "Core Counts")
						: t("settings.statistics.sections.managedScope", "Managed Team Scope")}
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						title={t("settings.statistics.cards.employees", "Employees")}
						value={stats.totalEmployees}
						description={t(
							"settings.statistics.cards.employeesDescription",
							"{active} active, {inactive} inactive",
							{ active: stats.activeEmployees, inactive: stats.inactiveEmployees },
						)}
						icon={<IconUsers className="size-4" />}
					/>
					<StatCard
						title={t("settings.statistics.cards.teams", "Teams")}
						value={stats.totalTeams}
						icon={<IconUsers className="size-4" />}
					/>
				</div>
			</section>

			<section>
				<h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
					<IconCalendarStats className="size-5" />
					{t("settings.statistics.sections.activityMetrics", "Activity Metrics")}
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						title={t("settings.statistics.cards.totalTimeEntries", "Total Time Entries")}
						value={stats.totalTimeEntries}
						icon={<IconClock className="size-4" />}
						trend={{
							value: timeEntryChange,
							label: t("settings.statistics.cards.vsLastMonth", "vs last month"),
							positive: timeEntryChange > 0 ? true : timeEntryChange < 0 ? false : undefined,
						}}
					/>
					<StatCard
						title={t("settings.statistics.cards.thisMonth", "This Month")}
						value={stats.timeEntriesThisMonth}
						description={t("settings.statistics.cards.timeEntries", "Time entries")}
						icon={<IconClock className="size-4" />}
					/>
					<StatCard
						title={t("settings.statistics.cards.totalAbsences", "Total Absences")}
						value={stats.totalAbsences}
						description={t("settings.statistics.cards.pendingCount", "{count} pending", {
							count: stats.pendingAbsences,
						})}
						icon={<IconCalendarStats className="size-4" />}
					/>
					<StatCard
						title={t("settings.statistics.cards.approvalRequests", "Approval Requests")}
						value={stats.totalApprovals}
						description={t("settings.statistics.cards.pendingCount", "{count} pending", {
							count: stats.pendingApprovals,
						})}
						icon={<IconChartBar className="size-4" />}
					/>
				</div>
			</section>

			<section>
				<h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
					<IconChartBar className="size-5" />
					{t("settings.statistics.sections.absenceBreakdown", "Absence Breakdown")}
				</h2>
				<div className="grid gap-4 md:grid-cols-3">
					<StatCard
						title={t("settings.statistics.cards.pendingAbsences", "Pending Absences")}
						value={stats.pendingAbsences}
						icon={<div className="h-3 w-3 rounded-full bg-yellow-500" />}
					/>
					<StatCard
						title={t("settings.statistics.cards.approvedAbsences", "Approved Absences")}
						value={stats.approvedAbsences}
						icon={<div className="h-3 w-3 rounded-full bg-green-500" />}
					/>
					<StatCard
						title={t("settings.statistics.cards.rejectedAbsences", "Rejected Absences")}
						value={stats.rejectedAbsences}
						icon={<div className="h-3 w-3 rounded-full bg-red-500" />}
					/>
				</div>
			</section>

			{orgStats ? (
				<section>
					<h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
						<IconRefresh className="size-5" />
						{t("settings.statistics.sections.systemHealth", "System Health")}
					</h2>
					<div className="grid gap-4 md:grid-cols-3">
						<StatCard
							title={t("settings.statistics.cards.activeSessions", "Active Sessions")}
							value={orgStats.activeSessions}
							description={t(
								"settings.statistics.cards.activeSessionsDescription",
								"Current database sessions",
							)}
							icon={<IconRefresh className="size-4" />}
						/>
					</div>
				</section>
			) : null}
		</div>
	);
}

function StatisticsLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>

			<section>
				<Skeleton className="mb-4 h-6 w-32" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{[...Array(4)].map((_, i) => (
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-24" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
								<Skeleton className="mt-2 h-3 w-32" />
							</CardContent>
						</Card>
					))}
				</div>
			</section>

			<section>
				<Skeleton className="mb-4 h-6 w-40" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{[...Array(4)].map((_, i) => (
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-24" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
								<Skeleton className="mt-2 h-3 w-32" />
							</CardContent>
						</Card>
					))}
				</div>
			</section>
		</div>
	);
}

export default function StatisticsPage() {
	return (
		<Suspense fallback={<StatisticsLoading />}>
			<StatisticsContent />
		</Suspense>
	);
}
