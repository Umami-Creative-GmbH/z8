import type { Queue } from "bullmq";
import type { JobData, JobResult } from "@/lib/queue";
import { CRON_JOBS, type CronJobName } from "./registry";

type SchedulerCronJobData = {
	type: CronJobName;
	triggeredAt: string;
};

type CronQueue = Queue<JobData | SchedulerCronJobData, JobResult>;
type RepeatableJob = Awaited<ReturnType<CronQueue["getRepeatableJobs"]>>[number];

export interface CronScheduleInput {
	pattern: string;
}

export type CronReconciliationResult =
	| { success: true; removedCount: number }
	| { success: false; removedCount: 0; error: string };

export async function reconcileCronJobSchedule({
	queue,
	jobName,
	pattern,
}: {
	queue: Pick<CronQueue, "getRepeatableJobs" | "removeRepeatableByKey" | "add">;
	jobName: CronJobName;
	pattern: string;
}): Promise<CronReconciliationResult> {
	try {
		const repeatableJobs = await queue.getRepeatableJobs();
		const targetRepeatables = repeatableJobs.filter((job) => job.name === jobName);
		const matchingRepeatables = targetRepeatables.filter((job) => job.pattern === pattern);
		const staleRepeatables = targetRepeatables.filter(
			(job): job is RepeatableJob & { key: string } =>
				job.pattern !== pattern && typeof job.key === "string" && job.key.length > 0,
		);

		if (matchingRepeatables.length === 0) {
			await queue.add(
				jobName,
				{ type: jobName, triggeredAt: new Date().toISOString() },
				{
					...CRON_JOBS[jobName].defaultJobOptions,
					repeat: { pattern },
					jobId: `cron-${jobName}`,
					removeOnComplete: {
						count: 50,
						age: 24 * 60 * 60,
					},
					removeOnFail: {
						count: 100,
						age: 7 * 24 * 60 * 60,
					},
				},
			);
		}

		for (const job of staleRepeatables) {
			await queue.removeRepeatableByKey(job.key);
		}

		return { success: true, removedCount: staleRepeatables.length };
	} catch (error) {
		return {
			success: false,
			removedCount: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function reconcileCronSchedules({
	queue,
	schedules,
}: {
	queue: Pick<CronQueue, "getRepeatableJobs" | "removeRepeatableByKey" | "add">;
	schedules: Record<CronJobName, CronScheduleInput>;
}): Promise<{
	reconciled: Array<{ jobName: CronJobName; removedCount: number }>;
	failed: Array<{ jobName: CronJobName; error: string }>;
}> {
	const reconciled: Array<{ jobName: CronJobName; removedCount: number }> = [];
	const failed: Array<{ jobName: CronJobName; error: string }> = [];

	for (const [jobName, schedule] of Object.entries(schedules) as Array<
		[CronJobName, CronScheduleInput]
	>) {
		const result = await reconcileCronJobSchedule({ queue, jobName, pattern: schedule.pattern });

		if (result.success) {
			reconciled.push({ jobName, removedCount: result.removedCount });
		} else {
			failed.push({ jobName, error: result.error });
		}
	}

	return { reconciled, failed };
}
