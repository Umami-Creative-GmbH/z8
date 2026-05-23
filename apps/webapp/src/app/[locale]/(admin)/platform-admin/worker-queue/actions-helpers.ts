import { type CronJobName, isCronJobName } from "@/lib/cron/registry";

export const RECENT_EXECUTION_LIMIT = 50;

const HIDDEN_WORKER_NAMES = new Set<CronJobName>(["cron:telemetry"]);

export interface CronExecutionForMapping {
	id: string;
	jobName: string;
	status: string;
	startedAt: Date;
	completedAt: Date | null;
	durationMs: number | null;
	error: string | null;
}

export interface JobNameSources {
	repeatableJobs: Array<{ name: string }>;
	recentExecutions: Array<{ jobName: string }>;
	jobMetrics: Array<{ jobName: string }>;
	reliabilityJobs: Array<{ jobName: string }>;
}

export function isVisibleCronJobName(name: string): name is CronJobName {
	return isCronJobName(name) && !HIDDEN_WORKER_NAMES.has(name);
}

export function mapCronExecution(exec: CronExecutionForMapping) {
	return {
		id: exec.id,
		jobName: exec.jobName,
		status: exec.status,
		startedAt: exec.startedAt.toISOString(),
		completedAt: exec.completedAt?.toISOString() ?? null,
		durationMs: exec.durationMs,
		error: exec.error,
	};
}

export function buildAvailableJobNames(sources: JobNameSources) {
	return Array.from(
		new Set([
			...sources.repeatableJobs.map((job) => job.name),
			...sources.recentExecutions.map((execution) => execution.jobName),
			...sources.jobMetrics.map((metric) => metric.jobName),
			...sources.reliabilityJobs.map((job) => job.jobName),
		]),
	)
		.filter(isVisibleCronJobName)
		.sort((a, b) => a.localeCompare(b));
}
