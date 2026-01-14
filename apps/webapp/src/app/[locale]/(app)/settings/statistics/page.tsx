import {
	IconBuilding,
	IconCalendarStats,
	IconChartBar,
	IconClock,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getInstanceStats } from "./actions";

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
				{description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
				{trend && (
					<p
						className={`text-xs mt-1 ${trend.positive ? "text-green-600" : trend.positive === false ? "text-red-600" : "text-muted-foreground"}`}
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
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.statistics.feature", "view instance statistics")} />
			</div>
		);
	}

	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	const statsResult = await getInstanceStats();

	if (!statsResult.success) {
		return (
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">{t("settings.statistics.title", "Statistics")}</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.statistics.description",
							"View statistics and metrics about your instance",
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

	const stats = statsResult.data;
	const timeEntryChange = stats.timeEntriesThisMonth - stats.timeEntriesLastMonth;

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="flex items-start justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">{t("settings.statistics.title", "Statistics")}</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.statistics.description",
							"View statistics and metrics about your instance",
						)}
					</p>
				</div>
				<p className="text-xs text-muted-foreground">
					{t("settings.statistics.lastUpdated", "Last updated")}:{" "}
					{new Date(stats.fetchedAt).toLocaleString()}
				</p>
			</div>

			{/* Core Counts Section */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconUsers className="size-5" />
					{t("settings.statistics.sections.coreCounts", "Core Counts")}
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						title={t("settings.statistics.cards.totalUsers", "Total Users")}
						value={stats.totalUsers}
						icon={<IconUsers className="size-4" />}
					/>
					<StatCard
						title={t("settings.statistics.cards.organizations", "Organizations")}
						value={stats.totalOrganizations}
						icon={<IconBuilding className="size-4" />}
					/>
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

			{/* Activity Metrics Section */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
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

			{/* Absence Breakdown */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
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

			{/* System Health Section */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconRefresh className="size-5" />
					{t("settings.statistics.sections.systemHealth", "System Health")}
				</h2>
				<div className="grid gap-4 md:grid-cols-3">
					<StatCard
						title={t("settings.statistics.cards.activeSessions", "Active Sessions")}
						value={stats.activeSessions}
						description={t(
							"settings.statistics.cards.activeSessionsDescription",
							"Current database sessions",
						)}
						icon={<IconRefresh className="size-4" />}
					/>
				</div>
			</section>
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
				<Skeleton className="h-6 w-32 mb-4" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{[...Array(4)].map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Static loading skeleton
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-24" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
								<Skeleton className="h-3 w-32 mt-2" />
							</CardContent>
						</Card>
					))}
				</div>
			</section>

			<section>
				<Skeleton className="h-6 w-40 mb-4" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{[...Array(4)].map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Static loading skeleton
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-24" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
								<Skeleton className="h-3 w-32 mt-2" />
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
