"use server";

import { Effect } from "effect";
import { reconcileCronJobSchedule } from "@/lib/cron/reconciliation";
import { CRON_JOBS, type CronJobName, isCronJobName } from "@/lib/cron/registry";
import {
	deleteCronScheduleOverride,
	listCronScheduleOverrides,
	upsertCronScheduleOverride,
} from "@/lib/cron/schedule-overrides";
import {
	buildScheduledJobRows,
	getPresetById,
	isHighRiskCronJob,
	type ScheduledCronJobRow,
} from "@/lib/cron/schedules";
import {
	getAllJobMetrics,
	getExecutionsSince,
	getJobExecutionHistory,
	getRecentExecutions,
} from "@/lib/cron/tracking";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { getJobQueue, isQueueHealthy } from "@/lib/queue";
import {
	buildAvailableJobNames,
	isVisibleCronJobName,
	mapCronExecution,
	RECENT_EXECUTION_LIMIT,
} from "./actions-helpers";
import { buildReliabilityData, type WorkerReliabilityData } from "./reliability";

export interface QueueCounts {
	waiting: number;
	active: number;
	completed: number;
	failed: number;
	delayed: number;
	paused: number;
}

export interface RepeatableJob {
	name: string;
	pattern: string;
	next: string | null;
}

export interface RecentExecution {
	id: string;
	jobName: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	error: string | null;
}

export interface JobMetric {
	jobName: string;
	totalRuns: number;
	successfulRuns: number;
	failedRuns: number;
	successRate: number;
	avgDurationMs: number | null;
}

export interface WorkerQueueStats {
	isConnected: boolean;
	counts: QueueCounts;
	repeatableJobs: RepeatableJob[];
	scheduledJobs: ScheduledCronJobRow[];
	availableJobNames: string[];
	recentExecutions: RecentExecution[];
	jobMetrics: JobMetric[];
	reliability: WorkerReliabilityData;
	fetchedAt: string;
}

export interface CronScheduleMutationResult {
	immediateReconciled: boolean;
	warning: string | null;
}

export interface CronScheduleMutationInput {
	jobName: string;
	presetId?: string;
	confirmation?: string;
}

const RELIABILITY_WINDOW_DAYS = 30;
const HIGH_RISK_CONFIRMATION = "I understand the operational impact";

function validateCronScheduleJob(input: CronScheduleMutationInput) {
	if (!isCronJobName(input.jobName) || !isVisibleCronJobName(input.jobName)) {
		return Effect.fail(
			new ValidationError({
				message: "Invalid cron job name",
				field: "jobName",
				value: input.jobName,
			}),
		);
	}

	const jobName = input.jobName;
	if (isHighRiskCronJob(jobName) && input.confirmation !== HIGH_RISK_CONFIRMATION) {
		return Effect.fail(
			new ValidationError({
				message: "High-risk cron schedule changes require confirmation",
				field: "confirmation",
			}),
		);
	}

	return Effect.succeed(jobName);
}

function reconcileCronSchedule(jobName: CronJobName, pattern: string) {
	return Effect.promise(async (): Promise<CronScheduleMutationResult> => {
		try {
			const result = await reconcileCronJobSchedule({ queue: getJobQueue(), jobName, pattern });

			if (!result.success) {
				return { immediateReconciled: false, warning: result.error };
			}

			return { immediateReconciled: true, warning: null };
		} catch (error) {
			return {
				immediateReconciled: false,
				warning: error instanceof Error ? error.message : String(error),
			};
		}
	});
}

export async function updateCronSchedule(
	input: CronScheduleMutationInput,
): Promise<ServerActionResult<CronScheduleMutationResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		const admin = yield* adminService.requirePlatformAdmin();
		const jobName = yield* validateCronScheduleJob(input);
		const preset = input.presetId ? getPresetById(input.presetId) : null;

		if (!preset) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Invalid cron schedule preset",
					field: "presetId",
					value: input.presetId,
				}),
			);
		}

		const defaultPattern = CRON_JOBS[jobName].schedule;
		if (preset.pattern === defaultPattern) {
			yield* Effect.tryPromise({
				try: () => deleteCronScheduleOverride(jobName),
				catch: () =>
					new DatabaseError({
						message: "Failed to delete cron schedule override",
						operation: "delete",
						table: "cron_schedule_override",
					}),
			});
		} else {
			yield* Effect.tryPromise({
				try: () =>
					upsertCronScheduleOverride({
						jobName,
						presetId: preset.id,
						pattern: preset.pattern,
						updatedBy: admin.userId,
					}),
				catch: () =>
					new DatabaseError({
						message: "Failed to save cron schedule override",
						operation: "upsert",
						table: "cron_schedule_override",
					}),
			});
		}

		const reconciliation = yield* reconcileCronSchedule(jobName, preset.pattern);

		yield* adminService.logAction(admin.userId, "update_cron_schedule", "cron_job", jobName, {
			oldPattern: defaultPattern,
			newPattern: preset.pattern,
			presetId: preset.id,
			immediateReconciled: reconciliation.immediateReconciled,
			reconciliationError: reconciliation.warning,
		});

		return reconciliation;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function resetCronSchedule(
	input: CronScheduleMutationInput,
): Promise<ServerActionResult<CronScheduleMutationResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		const admin = yield* adminService.requirePlatformAdmin();
		const jobName = yield* validateCronScheduleJob(input);
		const defaultPattern = CRON_JOBS[jobName].schedule;

		yield* Effect.tryPromise({
			try: () => deleteCronScheduleOverride(jobName),
			catch: () =>
				new DatabaseError({
					message: "Failed to delete cron schedule override",
					operation: "delete",
					table: "cron_schedule_override",
				}),
		});

		const reconciliation = yield* reconcileCronSchedule(jobName, defaultPattern);

		yield* adminService.logAction(admin.userId, "reset_cron_schedule", "cron_job", jobName, {
			oldPattern: defaultPattern,
			newPattern: defaultPattern,
			immediateReconciled: reconciliation.immediateReconciled,
			reconciliationError: reconciliation.warning,
		});

		return reconciliation;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getWorkerQueueStats(): Promise<ServerActionResult<WorkerQueueStats>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const isConnected = yield* Effect.promise(() => isQueueHealthy()).pipe(
			Effect.orElseSucceed(() => false),
		);

		let counts: QueueCounts = {
			waiting: 0,
			active: 0,
			completed: 0,
			failed: 0,
			delayed: 0,
			paused: 0,
		};

		let repeatableJobs: RepeatableJob[] = [];

		if (isConnected) {
			const queue = getJobQueue();

			const jobCounts = yield* Effect.tryPromise({
				try: () => queue.getJobCounts(),
				catch: () =>
					new DatabaseError({
						message: "Failed to fetch job counts",
						operation: "query",
					}),
			});

			counts = {
				waiting: jobCounts.waiting ?? 0,
				active: jobCounts.active ?? 0,
				completed: jobCounts.completed ?? 0,
				failed: jobCounts.failed ?? 0,
				delayed: jobCounts.delayed ?? 0,
				paused: jobCounts.paused ?? 0,
			};

			const repeatables = yield* Effect.promise(() => queue.getRepeatableJobs()).pipe(
				Effect.orElseSucceed(() => [] as Awaited<ReturnType<typeof queue.getRepeatableJobs>>),
			);

			repeatableJobs = repeatables
				.filter((job) => isVisibleCronJobName(job.name))
				.map((job) => ({
					name: job.name,
					pattern: job.pattern || "",
					next: job.next ? new Date(job.next).toISOString() : null,
				}));
		}

		const scheduleOverrides = yield* Effect.tryPromise({
			try: () => listCronScheduleOverrides(),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch cron schedule overrides",
					operation: "query",
					table: "cron_schedule_override",
				}),
		});

		const scheduledJobs = buildScheduledJobRows({
			overrides: scheduleOverrides,
			repeatableJobs,
		}).filter((job) => isVisibleCronJobName(job.name));

		const executions = yield* Effect.tryPromise({
			try: () => getRecentExecutions(RECENT_EXECUTION_LIMIT),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch recent executions",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		const recentExecutions: RecentExecution[] = executions
			.filter((exec) => isVisibleCronJobName(exec.jobName))
			.map(mapCronExecution);

		const metrics = yield* Effect.tryPromise({
			try: () => getAllJobMetrics(30),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch job metrics",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		const jobMetrics: JobMetric[] = metrics
			.filter((m) => isVisibleCronJobName(m.jobName))
			.map((m) => ({
				jobName: m.jobName,
				totalRuns: m.totalRuns,
				successfulRuns: m.successfulRuns,
				failedRuns: m.failedRuns,
				successRate: m.successRate,
				avgDurationMs: m.avgDurationMs,
			}));

		const reliabilityCutoff = new Date();
		reliabilityCutoff.setDate(reliabilityCutoff.getDate() - RELIABILITY_WINDOW_DAYS);

		const reliabilityExecutions = yield* Effect.tryPromise({
			try: () => getExecutionsSince(reliabilityCutoff),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch reliability execution history",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		const reliability = buildReliabilityData({
			now: new Date(),
			windowDays: RELIABILITY_WINDOW_DAYS,
			executions: reliabilityExecutions
				.filter((exec) => isVisibleCronJobName(exec.jobName))
				.map((exec) => ({
					id: exec.id,
					jobName: exec.jobName,
					status: exec.status,
					startedAt: exec.startedAt.toISOString(),
					completedAt: exec.completedAt?.toISOString() ?? null,
					durationMs: exec.durationMs,
				})),
			repeatableJobs,
		});

		const availableJobNames = buildAvailableJobNames({
			repeatableJobs,
			recentExecutions,
			jobMetrics,
			reliabilityJobs: reliability.jobs,
		});

		return {
			isConnected,
			counts,
			repeatableJobs,
			scheduledJobs,
			availableJobNames,
			recentExecutions,
			jobMetrics,
			reliability,
			fetchedAt: new Date().toISOString(),
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getWorkerQueueJobExecutions(
	jobName: string,
): Promise<ServerActionResult<RecentExecution[]>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		if (!isVisibleCronJobName(jobName)) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Invalid cron job name",
					field: "jobName",
					value: jobName,
				}),
			);
		}

		const executions = yield* Effect.tryPromise({
			try: () => getJobExecutionHistory(jobName, RECENT_EXECUTION_LIMIT),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch job execution history",
					operation: "query",
					table: "cron_job_execution",
				}),
		});

		return executions.map(mapCronExecution);
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
