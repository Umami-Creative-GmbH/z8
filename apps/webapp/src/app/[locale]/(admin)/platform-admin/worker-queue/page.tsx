import {
	IconActivity,
	IconAlertCircle,
	IconCheck,
	IconClock,
	IconLoader,
	IconPlayerPause,
	IconRefresh,
	IconServer,
	IconX,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getTranslate } from "@/tolgee/server";
import { getWorkerQueueStats } from "./actions";
import { RecentExecutions } from "./recent-executions";
import type { ReliabilityHealth } from "./reliability";
import { WorkerReliabilityCharts } from "./reliability-charts";

interface StatCardProps {
	title: string;
	value: number | string;
	locale: string;
	description?: string;
	icon: React.ReactNode;
	variant?: "default" | "success" | "warning" | "destructive";
}

function StatCard({ title, value, locale, description, icon, variant = "default" }: StatCardProps) {
	const variantStyles = {
		default: "",
		success: "border-green-500/50",
		warning: "border-yellow-500/50",
		destructive: "border-red-500/50",
	};

	return (
		<Card className={variantStyles[variant]}>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
				<div className="text-muted-foreground" aria-hidden="true">
					{icon}
				</div>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-bold">
					{typeof value === "number" ? value.toLocaleString(locale) : value}
				</div>
				{description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
			</CardContent>
		</Card>
	);
}

function formatPercent(value: number | null, unknownLabel: string, locale: string): string {
	if (value === null) {
		return unknownLabel;
	}

	return (value / 100).toLocaleString(locale, {
		style: "percent",
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
	});
}

function formatDuration(value: number | null, unknownLabel: string, locale: string): string {
	if (value === null) {
		return unknownLabel;
	}

	if (value >= 1000) {
		return (value / 1000).toLocaleString(locale, {
			style: "unit",
			unit: "second",
			unitDisplay: "short",
			maximumFractionDigits: 1,
			minimumFractionDigits: 1,
		});
	}

	return value.toLocaleString(locale, {
		style: "unit",
		unit: "millisecond",
		unitDisplay: "short",
		maximumFractionDigits: 0,
	});
}

function formatDateTime(value: string | null, locale: string): string {
	if (value === null) {
		return "-";
	}

	const dateTime = DateTime.fromISO(value).setLocale(locale);

	return dateTime.isValid ? dateTime.toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS) : "-";
}

function HealthBadge({
	health,
	labels,
}: {
	health: ReliabilityHealth;
	labels: Record<ReliabilityHealth, string>;
}) {
	switch (health) {
		case "healthy":
			return (
				<Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
					<IconCheck className="size-3 mr-1" aria-hidden="true" />
					{labels.healthy}
				</Badge>
			);
		case "warning":
			return (
				<Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">
					<IconAlertCircle className="size-3 mr-1" aria-hidden="true" />
					{labels.warning}
				</Badge>
			);
		case "failing":
			return (
				<Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400">
					<IconX className="size-3 mr-1" aria-hidden="true" />
					{labels.failing}
				</Badge>
			);
		case "stale":
			return (
				<Badge variant="outline" className="border-orange-500 text-orange-700 dark:text-orange-400">
					<IconClock className="size-3 mr-1" aria-hidden="true" />
					{labels.stale}
				</Badge>
			);
		case "unknown":
			return <Badge variant="outline">{labels.unknown}</Badge>;
	}
}

async function WorkerQueueContent({ locale }: { locale: string }) {
	await connection();

	const [t, statsResult] = await Promise.all([getTranslate(), getWorkerQueueStats()]);

	if (!statsResult.success) {
		return (
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">
						{t("settings.workerQueue.title", "Worker Queue")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.workerQueue.description",
							"Monitor background job processing and cron job executions",
						)}
					</p>
				</div>
				<Card className="border-destructive">
					<CardContent className="pt-6">
						<p className="text-destructive">
							{`${t("settings.workerQueue.loadError", "Failed to load queue status")}: ${statsResult.error}`}
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const stats = statsResult.data;
	const unknownLabel = t("settings.workerQueue.common.unknown", "Unknown");
	const statusLabels = {
		completed: t("settings.workerQueue.status.completed", "Completed"),
		failed: t("settings.workerQueue.status.failed", "Failed"),
		running: t("settings.workerQueue.status.running", "Running"),
		pending: t("settings.workerQueue.status.pending", "Pending"),
	};
	const recentExecutionsLabels = {
		description: t(
			"settings.workerQueue.recentExecutionsDescription",
			"Last 50 job executions tracked in the database.",
		),
		filterLabel: t("settings.workerQueue.recentExecutions.filterLabel", "Filter by job"),
		allJobs: t("settings.workerQueue.recentExecutions.allJobs", "All jobs"),
		loading: t("settings.workerQueue.recentExecutions.loading", "Loading executions…"),
		error: t("settings.workerQueue.recentExecutions.error", "Failed to load executions"),
		noExecutions: t("settings.workerQueue.noExecutions", "No recent executions found"),
		unknown: unknownLabel,
		status: statusLabels,
		table: {
			jobName: t("settings.workerQueue.table.jobName", "Job Name"),
			status: t("settings.workerQueue.table.status", "Status"),
			startedAt: t("settings.workerQueue.table.startedAt", "Started At"),
			duration: t("settings.workerQueue.table.duration", "Duration"),
			error: t("settings.workerQueue.table.error", "Error"),
		},
	};
	const healthLabels = {
		healthy: t("settings.workerQueue.reliability.healthy", "Healthy"),
		warning: t("settings.workerQueue.reliability.warning", "Warning"),
		failing: t("settings.workerQueue.reliability.failing", "Failing"),
		stale: t("settings.workerQueue.reliability.stale", "Stale"),
		unknown: t("settings.workerQueue.reliability.unknown", "Unknown"),
	} satisfies Record<ReliabilityHealth, string>;

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="flex items-start justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">
						{t("settings.workerQueue.title", "Worker Queue")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.workerQueue.description",
							"Monitor background job processing and cron job executions",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge
						variant={stats.isConnected ? "outline" : "destructive"}
						className={
							stats.isConnected ? "border-green-500 text-green-700 dark:text-green-400" : ""
						}
					>
						{stats.isConnected ? (
							<>
								<IconCheck className="size-3 mr-1" aria-hidden="true" />
								{t("settings.workerQueue.connected", "Connected")}
							</>
						) : (
							<>
								<IconAlertCircle className="size-3 mr-1" aria-hidden="true" />
								{t("settings.workerQueue.disconnected", "Disconnected")}
							</>
						)}
					</Badge>
					<p className="text-xs text-muted-foreground">
						{`${t("settings.workerQueue.lastUpdated", "Last updated")}: ${formatDateTime(stats.fetchedAt, locale)}`}
					</p>
				</div>
			</div>

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconServer className="size-5" aria-hidden="true" />
					{t("settings.workerQueue.sections.queueCounts", "Queue Status")}
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
					<StatCard
						title={t("settings.workerQueue.cards.waiting", "Waiting")}
						value={stats.counts.waiting}
						locale={locale}
						description={t(
							"settings.workerQueue.cards.waitingDescription",
							"Jobs waiting to be processed",
						)}
						icon={<IconClock className="size-4" />}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.active", "Active")}
						value={stats.counts.active}
						locale={locale}
						description={t("settings.workerQueue.cards.activeDescription", "Currently processing")}
						icon={<IconLoader className="size-4" />}
						variant={stats.counts.active > 0 ? "success" : "default"}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.completed", "Completed")}
						value={stats.counts.completed}
						locale={locale}
						description={t("settings.workerQueue.cards.completedDescription", "Recently completed")}
						icon={<IconCheck className="size-4" />}
						variant="success"
					/>
					<StatCard
						title={t("settings.workerQueue.cards.failed", "Failed")}
						value={stats.counts.failed}
						locale={locale}
						description={t("settings.workerQueue.cards.failedDescription", "Recently failed")}
						icon={<IconX className="size-4" />}
						variant={stats.counts.failed > 0 ? "destructive" : "default"}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.delayed", "Delayed")}
						value={stats.counts.delayed}
						locale={locale}
						description={t("settings.workerQueue.cards.delayedDescription", "Scheduled for later")}
						icon={<IconClock className="size-4" />}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.paused", "Paused")}
						value={stats.counts.paused}
						locale={locale}
						description={t("settings.workerQueue.cards.pausedDescription", "Paused jobs")}
						icon={<IconPlayerPause className="size-4" />}
						variant={stats.counts.paused > 0 ? "warning" : "default"}
					/>
				</div>
			</section>

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconActivity className="size-5" aria-hidden="true" />
					{t("settings.workerQueue.reliability.title", "Reliability")}
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						title={t("settings.workerQueue.reliability.successRate", "Success Rate")}
						value={formatPercent(stats.reliability.summary.successRate, unknownLabel, locale)}
						locale={locale}
						description={t(
							"settings.workerQueue.reliability.successRateDescription",
							"Terminal cron executions",
						)}
						icon={<IconCheck className="size-4" />}
						variant={
							stats.reliability.summary.successRate !== null &&
							stats.reliability.summary.successRate >= 95
								? "success"
								: "default"
						}
					/>
					<StatCard
						title={t("settings.workerQueue.reliability.failedRuns", "Failed Runs")}
						value={stats.reliability.summary.failedRuns}
						locale={locale}
						description={t(
							"settings.workerQueue.reliability.failedRunsDescription",
							"Last 30 days",
						)}
						icon={<IconX className="size-4" />}
						variant={stats.reliability.summary.failedRuns > 0 ? "destructive" : "default"}
					/>
					<StatCard
						title={t("settings.workerQueue.reliability.staleJobs", "Stale Jobs")}
						value={stats.reliability.summary.staleJobs}
						locale={locale}
						description={t(
							"settings.workerQueue.reliability.staleJobsDescription",
							"Past expected schedule",
						)}
						icon={<IconAlertCircle className="size-4" />}
						variant={stats.reliability.summary.staleJobs > 0 ? "warning" : "default"}
					/>
					<StatCard
						title={t("settings.workerQueue.reliability.avgDuration", "Avg Duration")}
						value={formatDuration(
							stats.reliability.summary.averageDurationMs,
							unknownLabel,
							locale,
						)}
						locale={locale}
						description={t(
							"settings.workerQueue.reliability.avgDurationDescription",
							"Executions with duration data",
						)}
						icon={<IconActivity className="size-4" />}
					/>
				</div>

				<div className="mt-4">
					<WorkerReliabilityCharts reliability={stats.reliability} />
				</div>

				<Card className="mt-4">
					<CardHeader>
						<CardTitle>{t("settings.workerQueue.reliability.jobHealth", "Job Health")}</CardTitle>
						<CardDescription>
							{t(
								"settings.workerQueue.reliability.jobHealthDescription",
								"Per-job reliability based on recent executions and repeatable schedules.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{stats.reliability.jobs.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t("settings.workerQueue.reliability.noJobs", "No reliability data found")}
							</p>
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("settings.workerQueue.table.jobName", "Job Name")}</TableHead>
											<TableHead>{t("settings.workerQueue.table.health", "Health")}</TableHead>
											<TableHead>{t("settings.workerQueue.table.lastRun", "Last Run")}</TableHead>
											<TableHead>{t("settings.workerQueue.table.nextRun", "Next Run")}</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.successRate", "Success Rate")}
											</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.failed", "Failed")}
											</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.avgDuration", "Avg Duration")}
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{stats.reliability.jobs.map((job) => (
											<TableRow key={job.jobName}>
												<TableCell className="font-mono text-sm">{job.jobName}</TableCell>
												<TableCell>
													<HealthBadge health={job.health} labels={healthLabels} />
												</TableCell>
												<TableCell>{formatDateTime(job.lastRunAt, locale)}</TableCell>
												<TableCell>{formatDateTime(job.nextRunAt, locale)}</TableCell>
												<TableCell className="text-right">
													{formatPercent(job.successRate, unknownLabel, locale)}
												</TableCell>
												<TableCell className="text-right text-red-600">{job.failedRuns}</TableCell>
												<TableCell className="text-right">
													{formatDuration(job.averageDurationMs, unknownLabel, locale)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</section>

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconRefresh className="size-5" aria-hidden="true" />
					{t("settings.workerQueue.sections.scheduledJobs", "Scheduled Cron Jobs")}
				</h2>
				<Card>
					<CardHeader>
						<CardDescription>
							{t(
								"settings.workerQueue.scheduledJobsDescription",
								"Repeatable jobs configured in the worker. These run automatically on schedule.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{stats.repeatableJobs.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t("settings.workerQueue.noScheduledJobs", "No scheduled jobs found")}
							</p>
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("settings.workerQueue.table.jobName", "Job Name")}</TableHead>
											<TableHead>{t("settings.workerQueue.table.schedule", "Schedule")}</TableHead>
											<TableHead>{t("settings.workerQueue.table.nextRun", "Next Run")}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{stats.repeatableJobs.map((job) => (
											<TableRow key={`${job.name}-${job.pattern}`}>
												<TableCell className="font-mono text-sm">{job.name}</TableCell>
												<TableCell className="font-mono text-sm">{job.pattern}</TableCell>
												<TableCell>{formatDateTime(job.next, locale)}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</section>

			{stats.jobMetrics.length > 0 && (
				<section>
					<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
						<IconServer className="size-5" aria-hidden="true" />
						{t("settings.workerQueue.sections.jobMetrics", "Job Metrics (Last 30 Days)")}
					</h2>
					<Card>
						<CardContent className="pt-6">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("settings.workerQueue.table.jobName", "Job Name")}</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.totalRuns", "Total Runs")}
											</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.successful", "Successful")}
											</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.failed", "Failed")}
											</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.successRate", "Success Rate")}
											</TableHead>
											<TableHead className="text-right">
												{t("settings.workerQueue.table.avgDuration", "Avg Duration")}
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{stats.jobMetrics.map((metric) => (
											<TableRow key={metric.jobName}>
												<TableCell className="font-mono text-sm">{metric.jobName}</TableCell>
												<TableCell className="text-right">{metric.totalRuns}</TableCell>
												<TableCell className="text-right text-green-600">
													{metric.successfulRuns}
												</TableCell>
												<TableCell className="text-right text-red-600">
													{metric.failedRuns}
												</TableCell>
												<TableCell className="text-right">
													<span
														className={
															metric.successRate >= 95
																? "text-green-600"
																: metric.successRate >= 80
																	? "text-yellow-600"
																	: "text-red-600"
														}
													>
														{formatPercent(metric.successRate, unknownLabel, locale)}
													</span>
												</TableCell>
												<TableCell className="text-right">
													{formatDuration(metric.avgDurationMs, unknownLabel, locale)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>
				</section>
			)}

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconClock className="size-5" aria-hidden="true" />
					{t("settings.workerQueue.sections.recentExecutions", "Recent Executions")}
				</h2>
				<RecentExecutions
					availableJobNames={stats.availableJobNames}
					initialExecutions={stats.recentExecutions}
					labels={recentExecutionsLabels}
					locale={locale}
				/>
			</section>
		</div>
	);
}

function WorkerQueueLoading() {
	const queueSkeletonKeys = ["waiting", "active", "completed", "failed", "delayed", "paused"];
	const reliabilitySkeletonKeys = ["success-rate", "failed-runs", "stale-jobs", "avg-duration"];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>

			<section>
				<Skeleton className="h-6 w-32 mb-4" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
					{queueSkeletonKeys.map((key) => (
						<Card key={key}>
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
				<Skeleton className="h-6 w-36 mb-4" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{reliabilitySkeletonKeys.map((key) => (
						<Card key={key}>
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
				<div className="grid gap-4 lg:grid-cols-2 mt-4">
					<Card>
						<CardHeader>
							<Skeleton className="h-5 w-36" />
							<Skeleton className="h-4 w-64" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-[300px] w-full" />
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<Skeleton className="h-5 w-36" />
							<Skeleton className="h-4 w-64" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-[300px] w-full" />
						</CardContent>
					</Card>
				</div>
				<Card className="mt-4">
					<CardHeader>
						<Skeleton className="h-5 w-28" />
						<Skeleton className="h-4 w-72" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-32 w-full" />
					</CardContent>
				</Card>
			</section>

			<section>
				<Skeleton className="h-6 w-40 mb-4" />
				<Card>
					<CardHeader>
						<Skeleton className="h-4 w-64" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-32 w-full" />
					</CardContent>
				</Card>
			</section>
		</div>
	);
}

export default async function WorkerQueuePage({ params }: { params: Promise<{ locale: string }> }) {
	const { locale } = await params;

	return (
		<Suspense fallback={<WorkerQueueLoading />}>
			<WorkerQueueContent locale={locale} />
		</Suspense>
	);
}
