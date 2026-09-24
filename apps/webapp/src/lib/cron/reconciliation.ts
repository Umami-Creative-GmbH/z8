import type { Queue } from "bullmq";
import type { JobData, JobResult } from "@/lib/queue";
import { CRON_JOBS, type CronJobName } from "./registry";
import { isLegacyEscalationSchedulerRetired, LEGACY_ESCALATION_JOB_NAMES } from "./legacy-escalation-schedulers";

type SchedulerCronJobData = {
	type: CronJobName;
	triggeredAt: string;
};

type CronQueue = Pick<Queue<JobData | SchedulerCronJobData, JobResult>, "upsertJobScheduler" | "removeJobScheduler">;

export interface CronScheduleInput {
	pattern: string;
}

export type CronReconciliationResult =
	| { success: true; retired?: true }
	| { success: false; error: string };

export async function reconcileCronJobSchedule({
	queue,
	jobName,
	pattern,
}: {
	queue: CronQueue;
	jobName: CronJobName;
	pattern: string;
}): Promise<CronReconciliationResult> {
	try {
		if (isLegacyEscalationSchedulerRetired(jobName)) {
			// False means already absent. Removal is idempotent, and deliberately
			// does not drain active jobs or remove the retained consumer handler.
			await queue.removeJobScheduler(`cron-${jobName}`);
			return { success: true, retired: true };
		}
		await queue.upsertJobScheduler(
			`cron-${jobName}`,
			{ pattern },
			{
				name: jobName,
				data: { type: jobName, triggeredAt: new Date().toISOString() },
				opts: {
					...CRON_JOBS[jobName].defaultJobOptions,
					removeOnComplete: {
						count: 50,
						age: 24 * 60 * 60,
					},
					removeOnFail: {
						count: 100,
						age: 7 * 24 * 60 * 60,
					},
				},
			},
		);

		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Also run when scheduler registration is disabled. Redis failures stay visible. */
export async function retireLegacyEscalationSchedulers(queue: CronQueue) {
	const results = await Promise.all(
		LEGACY_ESCALATION_JOB_NAMES.filter(isLegacyEscalationSchedulerRetired).map(async (jobName) => ({
			jobName,
			result: await reconcileCronJobSchedule({ queue, jobName, pattern: CRON_JOBS[jobName].schedule }),
		})),
	);
	return results;
}

export async function reconcileCronSchedules({
	queue,
	schedules,
}: {
	queue: CronQueue;
	schedules: Record<CronJobName, CronScheduleInput>;
}): Promise<{
	reconciled: Array<{ jobName: CronJobName }>;
	retired: Array<{ jobName: CronJobName }>;
	failed: Array<{ jobName: CronJobName; error: string }>;
}> {
	const reconciled: Array<{ jobName: CronJobName }> = [];
	const retired: Array<{ jobName: CronJobName }> = [];
	const failed: Array<{ jobName: CronJobName; error: string }> = [];

	const results = await Promise.all(
		(Object.entries(schedules) as Array<[CronJobName, CronScheduleInput]>).map(
			async ([jobName, schedule]) => ({
				jobName,
				result: await reconcileCronJobSchedule({ queue, jobName, pattern: schedule.pattern }),
			}),
		),
	);

	for (const { jobName, result } of results) {
		if (!result.success) {
			failed.push({ jobName, error: result.error });
		} else if (result.retired) {
			// Removed, not installed: report separately so it is not read as an active schedule.
			retired.push({ jobName });
		} else {
			reconciled.push({ jobName });
		}
	}

	return { reconciled, retired, failed };
}
