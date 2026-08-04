import type { Queue } from "bullmq";
import type { JobData, JobResult } from "@/lib/queue";
import { CRON_JOBS, type CronJobName } from "./registry";

type SchedulerCronJobData = {
	type: CronJobName;
	triggeredAt: string;
};

type CronQueue = Pick<Queue<JobData | SchedulerCronJobData, JobResult>, "upsertJobScheduler">;

export interface CronScheduleInput {
	pattern: string;
}

export type CronReconciliationResult =
	| { success: true }
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

export async function reconcileCronSchedules({
	queue,
	schedules,
}: {
	queue: CronQueue;
	schedules: Record<CronJobName, CronScheduleInput>;
}): Promise<{
	reconciled: Array<{ jobName: CronJobName }>;
	failed: Array<{ jobName: CronJobName; error: string }>;
}> {
	const reconciled: Array<{ jobName: CronJobName }> = [];
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
		if (result.success) {
			reconciled.push({ jobName });
		} else {
			failed.push({ jobName, error: result.error });
		}
	}

	return { reconciled, failed };
}
