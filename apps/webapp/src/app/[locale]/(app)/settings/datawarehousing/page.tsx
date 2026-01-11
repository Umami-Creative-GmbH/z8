import {
	IconBuilding,
	IconCalendarStats,
	IconChartBar,
	IconClock,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
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

async function DatawarehouseContent() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view instance statistics" />
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
					<h1 className="text-2xl font-semibold">Datawarehousing</h1>
					<p className="text-muted-foreground">View statistics and metrics about your instance</p>
				</div>
				<Card className="border-destructive">
					<CardContent className="pt-6">
						<p className="text-destructive">Failed to load statistics: {statsResult.error}</p>
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
					<h1 className="text-2xl font-semibold">Datawarehousing</h1>
					<p className="text-muted-foreground">View statistics and metrics about your instance</p>
				</div>
				<p className="text-xs text-muted-foreground">
					Last updated: {new Date(stats.fetchedAt).toLocaleString()}
				</p>
			</div>

			{/* Core Counts Section */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconUsers className="size-5" />
					Core Counts
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						title="Total Users"
						value={stats.totalUsers}
						icon={<IconUsers className="size-4" />}
					/>
					<StatCard
						title="Organizations"
						value={stats.totalOrganizations}
						icon={<IconBuilding className="size-4" />}
					/>
					<StatCard
						title="Employees"
						value={stats.totalEmployees}
						description={`${stats.activeEmployees} active, ${stats.inactiveEmployees} inactive`}
						icon={<IconUsers className="size-4" />}
					/>
					<StatCard
						title="Teams"
						value={stats.totalTeams}
						icon={<IconUsers className="size-4" />}
					/>
				</div>
			</section>

			{/* Activity Metrics Section */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconCalendarStats className="size-5" />
					Activity Metrics
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						title="Total Time Entries"
						value={stats.totalTimeEntries}
						icon={<IconClock className="size-4" />}
						trend={{
							value: timeEntryChange,
							label: "vs last month",
							positive: timeEntryChange > 0 ? true : timeEntryChange < 0 ? false : undefined,
						}}
					/>
					<StatCard
						title="This Month"
						value={stats.timeEntriesThisMonth}
						description="Time entries"
						icon={<IconClock className="size-4" />}
					/>
					<StatCard
						title="Total Absences"
						value={stats.totalAbsences}
						description={`${stats.pendingAbsences} pending`}
						icon={<IconCalendarStats className="size-4" />}
					/>
					<StatCard
						title="Approval Requests"
						value={stats.totalApprovals}
						description={`${stats.pendingApprovals} pending`}
						icon={<IconChartBar className="size-4" />}
					/>
				</div>
			</section>

			{/* Absence Breakdown */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconChartBar className="size-5" />
					Absence Breakdown
				</h2>
				<div className="grid gap-4 md:grid-cols-3">
					<StatCard
						title="Pending Absences"
						value={stats.pendingAbsences}
						icon={<div className="h-3 w-3 rounded-full bg-yellow-500" />}
					/>
					<StatCard
						title="Approved Absences"
						value={stats.approvedAbsences}
						icon={<div className="h-3 w-3 rounded-full bg-green-500" />}
					/>
					<StatCard
						title="Rejected Absences"
						value={stats.rejectedAbsences}
						icon={<div className="h-3 w-3 rounded-full bg-red-500" />}
					/>
				</div>
			</section>

			{/* System Health Section */}
			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconRefresh className="size-5" />
					System Health
				</h2>
				<div className="grid gap-4 md:grid-cols-3">
					<StatCard
						title="Active Sessions"
						value={stats.activeSessions}
						description="Current database sessions"
						icon={<IconRefresh className="size-4" />}
					/>
				</div>
			</section>
		</div>
	);
}

function DatawarehouseLoading() {
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

export default function DatawarehousePage() {
	return (
		<Suspense fallback={<DatawarehouseLoading />}>
			<DatawarehouseContent />
		</Suspense>
	);
}
