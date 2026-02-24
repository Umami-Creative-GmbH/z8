import {
	IconAlertCircle,
	IconCheck,
	IconClock,
	IconLoader,
	IconPlayerPause,
	IconRefresh,
	IconServer,
	IconX,
} from "@tabler/icons-react";
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

interface StatCardProps {
	title: string;
	value: number | string;
	description?: string;
	icon: React.ReactNode;
	variant?: "default" | "success" | "warning" | "destructive";
}

function StatCard({ title, value, description, icon, variant = "default" }: StatCardProps) {
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
				<div className="text-muted-foreground">{icon}</div>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-bold">
					{typeof value === "number" ? value.toLocaleString() : value}
				</div>
				{description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
			</CardContent>
		</Card>
	);
}

function StatusBadge({ status }: { status: string }) {
	switch (status) {
		case "completed":
			return (
				<Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
					<IconCheck className="size-3 mr-1" />
					Completed
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400">
					<IconX className="size-3 mr-1" />
					Failed
				</Badge>
			);
		case "running":
			return (
				<Badge variant="outline" className="border-blue-500 text-blue-700 dark:text-blue-400">
					<IconLoader className="size-3 mr-1 animate-spin" />
					Running
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">
					<IconClock className="size-3 mr-1" />
					Pending
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

async function WorkerQueueContent() {
	await connection();

	const t = await getTranslate();
	const statsResult = await getWorkerQueueStats();

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
							{t("settings.workerQueue.loadError", "Failed to load queue status")}: {" "}
							{statsResult.error}
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const stats = statsResult.data;

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
								<IconCheck className="size-3 mr-1" />
								{t("settings.workerQueue.connected", "Connected")}
							</>
						) : (
							<>
								<IconAlertCircle className="size-3 mr-1" />
								{t("settings.workerQueue.disconnected", "Disconnected")}
							</>
						)}
					</Badge>
					<p className="text-xs text-muted-foreground">
						{t("settings.workerQueue.lastUpdated", "Last updated")}: {" "}
						{new Date(stats.fetchedAt).toLocaleString()}
					</p>
				</div>
			</div>

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconServer className="size-5" />
					{t("settings.workerQueue.sections.queueCounts", "Queue Status")}
				</h2>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
					<StatCard
						title={t("settings.workerQueue.cards.waiting", "Waiting")}
						value={stats.counts.waiting}
						description={t(
							"settings.workerQueue.cards.waitingDescription",
							"Jobs waiting to be processed",
						)}
						icon={<IconClock className="size-4" />}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.active", "Active")}
						value={stats.counts.active}
						description={t("settings.workerQueue.cards.activeDescription", "Currently processing")}
						icon={<IconLoader className="size-4" />}
						variant={stats.counts.active > 0 ? "success" : "default"}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.completed", "Completed")}
						value={stats.counts.completed}
						description={t("settings.workerQueue.cards.completedDescription", "Recently completed")}
						icon={<IconCheck className="size-4" />}
						variant="success"
					/>
					<StatCard
						title={t("settings.workerQueue.cards.failed", "Failed")}
						value={stats.counts.failed}
						description={t("settings.workerQueue.cards.failedDescription", "Recently failed")}
						icon={<IconX className="size-4" />}
						variant={stats.counts.failed > 0 ? "destructive" : "default"}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.delayed", "Delayed")}
						value={stats.counts.delayed}
						description={t("settings.workerQueue.cards.delayedDescription", "Scheduled for later")}
						icon={<IconClock className="size-4" />}
					/>
					<StatCard
						title={t("settings.workerQueue.cards.paused", "Paused")}
						value={stats.counts.paused}
						description={t("settings.workerQueue.cards.pausedDescription", "Paused jobs")}
						icon={<IconPlayerPause className="size-4" />}
						variant={stats.counts.paused > 0 ? "warning" : "default"}
					/>
				</div>
			</section>

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconRefresh className="size-5" />
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
											<TableCell>{job.next ? new Date(job.next).toLocaleString() : "-"}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</section>

			{stats.jobMetrics.length > 0 && (
				<section>
					<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
						<IconServer className="size-5" />
						{t("settings.workerQueue.sections.jobMetrics", "Job Metrics (Last 30 Days)")}
					</h2>
					<Card>
						<CardContent className="pt-6">
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
											<TableCell className="text-right text-red-600">{metric.failedRuns}</TableCell>
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
													{metric.successRate.toFixed(1)}%
												</span>
											</TableCell>
											<TableCell className="text-right">
												{metric.avgDurationMs ? `${metric.avgDurationMs}ms` : "-"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</section>
			)}

			<section>
				<h2 className="text-lg font-medium mb-4 flex items-center gap-2">
					<IconClock className="size-5" />
					{t("settings.workerQueue.sections.recentExecutions", "Recent Executions")}
				</h2>
				<Card>
					<CardHeader>
						<CardDescription>
							{t(
								"settings.workerQueue.recentExecutionsDescription",
								"Last 50 job executions tracked in the database.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{stats.recentExecutions.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t("settings.workerQueue.noExecutions", "No recent executions found")}
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("settings.workerQueue.table.jobName", "Job Name")}</TableHead>
										<TableHead>{t("settings.workerQueue.table.status", "Status")}</TableHead>
										<TableHead>{t("settings.workerQueue.table.startedAt", "Started At")}</TableHead>
										<TableHead>{t("settings.workerQueue.table.duration", "Duration")}</TableHead>
										<TableHead>{t("settings.workerQueue.table.error", "Error")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{stats.recentExecutions.map((exec) => (
										<TableRow key={exec.id}>
											<TableCell className="font-mono text-sm">{exec.jobName}</TableCell>
											<TableCell>
												<StatusBadge status={exec.status} />
											</TableCell>
											<TableCell>{new Date(exec.startedAt).toLocaleString()}</TableCell>
											<TableCell>{exec.durationMs ? `${exec.durationMs}ms` : "-"}</TableCell>
											<TableCell
												className="max-w-xs truncate text-red-600"
												title={exec.error ?? undefined}
											>
												{exec.error ?? "-"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</section>
		</div>
	);
}

function WorkerQueueLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>

			<section>
				<Skeleton className="h-6 w-32 mb-4" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
					{[...Array(6)].map((_, i) => (
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

export default function WorkerQueuePage() {
	return (
		<Suspense fallback={<WorkerQueueLoading />}>
			<WorkerQueueContent />
		</Suspense>
	);
}
