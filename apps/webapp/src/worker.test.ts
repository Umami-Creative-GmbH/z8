import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CronJobData } from "@/lib/cron";
import type { JobData, JobResult } from "@/lib/queue";

const mocks = vi.hoisted(() => ({
	auditPack: vi.fn(),
	createJobExecution: vi.fn(),
	cronProcessor: vi.fn(),
	getJobExecutionByBullmqJobId: vi.fn(),
	getOrCreateSchedulerJobExecution: vi.fn(),
	loggerError: vi.fn(),
	loggerWarn: vi.fn(),
	markJobCompleted: vi.fn(),
	markJobFailed: vi.fn(),
	markJobRunning: vi.fn(),
	processCalendarSyncJob: vi.fn(),
	processWebhookJob: vi.fn(),
}));

vi.mock("@/lib/cron", () => ({
	CRON_JOBS: {
		"cron:telemetry": {
			processor: mocks.cronProcessor,
		},
	},
	createJobExecution: mocks.createJobExecution,
	getJobExecutionByBullmqJobId: mocks.getJobExecutionByBullmqJobId,
	getOrCreateSchedulerJobExecution: mocks.getOrCreateSchedulerJobExecution,
	isCronJobName: (type: string) => type === "cron:telemetry",
	listCronScheduleOverrides: vi.fn(),
	markJobCompleted: mocks.markJobCompleted,
	markJobFailed: mocks.markJobFailed,
	markJobRunning: mocks.markJobRunning,
	reconcileCronSchedules: vi.fn(),
	resolveEffectiveCronSchedules: vi.fn(),
}));

vi.mock("@/lib/audit-pack/application/audit-pack-processor", () => ({
	processAuditPack: mocks.auditPack,
}));

vi.mock("@/lib/webhooks/webhook-worker", () => ({
	processWebhookJob: mocks.processWebhookJob,
}));

vi.mock("@/lib/calendar-sync/jobs", () => ({
	processCalendarSyncJob: mocks.processCalendarSyncJob,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: mocks.loggerError,
		info: vi.fn(),
		warn: mocks.loggerWarn,
	}),
}));

vi.mock("@/lib/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/queue")>()),
	createWorker: vi.fn(),
	getJobQueue: vi.fn(),
}));

const {
	logRegisteredJobSchedulers,
	processJob,
	processOneOffJob,
	reconcileCronJobCompletion,
	reconcileCronJobFailure,
	registerCronTrackingListeners,
} = await import("@/worker");

describe("logRegisteredJobSchedulers", () => {
	it("warns without throwing when scheduler inspection fails", async () => {
		const error = new Error("Redis unavailable");
		const queue = {
			getJobSchedulers: vi.fn().mockRejectedValue(error),
		};

		await expect(logRegisteredJobSchedulers(queue)).resolves.toBeUndefined();
		expect(mocks.loggerWarn).toHaveBeenCalledWith(
			{ error },
			"Failed to list registered job schedulers; worker startup will continue",
		);
	});
});

function createCronJob({
	executionId,
	attemptsMade = 0,
	attempts = 3,
}: {
	executionId?: string;
	attemptsMade?: number;
	attempts?: number;
}) {
	const data = {
		type: "cron:telemetry",
		triggeredAt: "2026-07-10T08:00:00.000Z",
		...(executionId ? { executionId } : {}),
	};

	return {
		id: "cron-job-1",
		name: "cron:telemetry",
		data,
		attemptsMade,
		opts: { attempts },
		updateData: vi.fn(async (updatedData: typeof data & { executionId: string }) => {
			Object.assign(data, updatedData);
		}),
	} as unknown as Job<CronJobData>;
}

describe("processOneOffJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.auditPack.mockResolvedValue(undefined);
		mocks.processCalendarSyncJob.mockResolvedValue({ success: true });
		mocks.processWebhookJob.mockResolvedValue({ success: true });
	});

	it("normalizes and rejects audit pack processor failures", async () => {
		mocks.auditPack.mockRejectedValueOnce("audit unavailable");
		const job = {
			id: "audit-job-1",
			name: "process-audit-pack",
			data: { type: "audit-pack", requestId: "request-1", organizationId: "org-1" },
		} as Job<JobData>;

		const error = await processOneOffJob(job).catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ message: "audit unavailable" });
	});

	it("rejects unknown job types", async () => {
		const job = {
			id: "unknown-job-1",
			name: "unknown",
			data: { type: "unknown" },
		} as unknown as Job<JobData>;

		await expect(processOneOffJob(job)).rejects.toThrow("Unknown job type: unknown");
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{ error: "Unknown job type: unknown", jobId: "unknown-job-1" },
			"Job failed",
		);
	});

	it("preserves intentional webhook semantic failure results", async () => {
		const semanticFailure = { success: false, error: "Endpoint is inactive" };
		mocks.processWebhookJob.mockResolvedValueOnce(semanticFailure);
		const job = {
			id: "webhook-job-1",
			name: "deliver-webhook",
			data: { type: "webhook" },
		} as unknown as Job<JobData>;

		await expect(processOneOffJob(job)).resolves.toEqual(semanticFailure);
	});

	it("normalizes and logs failures from semantic-result processors", async () => {
		mocks.processWebhookJob.mockRejectedValueOnce("webhook unavailable");
		const job = {
			id: "webhook-job-1",
			name: "deliver-webhook",
			data: { type: "webhook" },
		} as unknown as Job<JobData>;

		const error = await processOneOffJob(job).catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ message: "webhook unavailable" });
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{ error: "webhook unavailable", jobId: "webhook-job-1" },
			"Job failed",
		);
	});

	it("preserves intentional calendar sync semantic failure results", async () => {
		const semanticFailure = { success: false, error: "Calendar disconnected" };
		mocks.processCalendarSyncJob.mockResolvedValueOnce(semanticFailure);
		const job = {
			id: "calendar-job-1",
			name: "calendar-sync",
			data: {
				type: "calendar-sync",
				absenceId: "absence-1",
				employeeId: "employee-1",
				action: "create",
			},
		} as Job<JobData>;

		await expect(processOneOffJob(job)).resolves.toEqual(semanticFailure);
	});

	it("propagates calendar sync processor rejections", async () => {
		mocks.processCalendarSyncJob.mockRejectedValueOnce(new Error("calendar unavailable"));
		const job = {
			id: "calendar-job-1",
			name: "calendar-sync",
			data: {
				type: "calendar-sync",
				absenceId: "absence-1",
				employeeId: "employee-1",
				action: "create",
			},
		} as Job<JobData>;

		await expect(processOneOffJob(job)).rejects.toThrow("calendar unavailable");
	});
});

describe("processJob cron failure semantics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createJobExecution.mockResolvedValue("execution-created");
		mocks.cronProcessor.mockResolvedValue({ collected: true });
		mocks.getJobExecutionByBullmqJobId.mockResolvedValue(undefined);
		mocks.getOrCreateSchedulerJobExecution.mockResolvedValue("execution-created");
	});

	it("rejects an intermediate attempt without marking the execution failed", async () => {
		mocks.cronProcessor.mockRejectedValueOnce(new Error("temporary cron failure"));
		const job = createCronJob({ executionId: "execution-api", attemptsMade: 0, attempts: 3 });

		await expect(processJob(job)).rejects.toThrow("temporary cron failure");

		expect(mocks.markJobRunning).toHaveBeenCalledWith("execution-api");
		expect(mocks.markJobFailed).not.toHaveBeenCalled();
	});

	it("marks the execution failed on the final configured attempt and rejects", async () => {
		mocks.cronProcessor.mockRejectedValueOnce(new Error("terminal cron failure"));
		const job = createCronJob({ executionId: "execution-api", attemptsMade: 2, attempts: 3 });

		await expect(processJob(job)).rejects.toThrow("terminal cron failure");

		expect(mocks.markJobFailed).toHaveBeenCalledWith(
			"execution-api",
			"terminal cron failure",
			expect.any(Number),
		);
	});

	it("preserves the processor error when final failure tracking also fails", async () => {
		const processorError = new Error("terminal cron failure");
		const trackingError = new Error("database unavailable");
		mocks.cronProcessor.mockRejectedValueOnce(processorError);
		mocks.markJobFailed.mockRejectedValueOnce(trackingError);
		const job = createCronJob({ executionId: "execution-api", attemptsMade: 2, attempts: 3 });

		await expect(processJob(job)).rejects.toBe(processorError);
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{
				error: trackingError,
				executionId: "execution-api",
				jobId: "cron-job-1",
				type: "cron:telemetry",
			},
			"Failed to mark cron job failed",
		);
	});

	it("persists a scheduler execution ID into the BullMQ job before processing", async () => {
		const job = createCronJob({ attemptsMade: 0, attempts: 3 });

		await processJob(job);

		expect(mocks.getOrCreateSchedulerJobExecution).toHaveBeenCalledWith({
			bullmqJobId: "cron-job-1",
			jobName: "cron:telemetry",
		});
		expect(job.updateData).toHaveBeenCalledWith({
			type: "cron:telemetry",
			triggeredAt: "2026-07-10T08:00:00.000Z",
			executionId: "execution-created",
		});
		expect(job.updateData).toHaveBeenCalledBefore(mocks.markJobRunning);
		expect(job.updateData).toHaveBeenCalledBefore(mocks.cronProcessor);
		expect(mocks.cronProcessor).toHaveBeenCalledTimes(1);
	});

	it("reuses the database execution after updateData fails before a retry", async () => {
		const job = createCronJob({ attemptsMade: 0, attempts: 3 });
		vi.mocked(job.updateData).mockRejectedValueOnce(new Error("Redis write failed"));

		await expect(processJob(job)).rejects.toThrow("Redis write failed");
		await expect(processJob(job)).resolves.toMatchObject({ success: true });

		expect(mocks.getOrCreateSchedulerJobExecution).toHaveBeenCalledTimes(2);
		expect(mocks.createJobExecution).not.toHaveBeenCalled();
		expect(mocks.markJobRunning).toHaveBeenCalledWith("execution-created");
		expect(mocks.cronProcessor).toHaveBeenCalledTimes(1);
	});

	it("uses an API-provided execution ID without creating or persisting another", async () => {
		const job = createCronJob({ executionId: "execution-api", attemptsMade: 0, attempts: 3 });

		await processJob(job);

		expect(mocks.getOrCreateSchedulerJobExecution).not.toHaveBeenCalled();
		expect(job.updateData).not.toHaveBeenCalled();
		expect(mocks.markJobRunning).toHaveBeenCalledWith("execution-api");
	});

	it("reuses the persisted scheduler execution ID on retry", async () => {
		const job = createCronJob({ executionId: "execution-created", attemptsMade: 1, attempts: 3 });

		await processJob(job);

		expect(mocks.getOrCreateSchedulerJobExecution).not.toHaveBeenCalled();
		expect(job.updateData).not.toHaveBeenCalled();
		expect(mocks.markJobRunning).toHaveBeenCalledWith("execution-created");
	});

	it("marks a successful retry completed using the same execution ID", async () => {
		const job = createCronJob({ executionId: "execution-created", attemptsMade: 1, attempts: 3 });

		await expect(processJob(job)).resolves.toMatchObject({ success: true });

		expect(mocks.markJobCompleted).toHaveBeenCalledWith(
			"execution-created",
			{ collected: true },
			expect.any(Number),
		);
	});

	it("returns success when completion tracking fails after the processor succeeds", async () => {
		const trackingError = new Error("database unavailable");
		mocks.markJobCompleted.mockRejectedValueOnce(trackingError);
		const job = createCronJob({ executionId: "execution-api", attemptsMade: 0, attempts: 3 });

		await expect(processJob(job)).resolves.toMatchObject({
			success: true,
			data: { collected: true },
		});

		expect(mocks.cronProcessor).toHaveBeenCalledTimes(1);
		expect(mocks.markJobFailed).not.toHaveBeenCalled();
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{
				error: trackingError,
				executionId: "execution-api",
				jobId: "cron-job-1",
				type: "cron:telemetry",
			},
			"Failed to mark cron job completed",
		);
	});
});

describe("cron event reconciliation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getJobExecutionByBullmqJobId.mockResolvedValue(undefined);
	});

	it("reconciles completion using the execution ID in job data", async () => {
		const job = {
			id: "cron-job-1",
			data: {
				type: "cron:telemetry",
				triggeredAt: "2026-07-10T08:00:00.000Z",
				executionId: "execution-api",
			},
			processedOn: 100,
			finishedOn: 250,
		} as unknown as Job<JobData, JobResult>;

		await reconcileCronJobCompletion(job, {
			success: true,
			data: { collected: true },
		});

		expect(mocks.markJobCompleted).toHaveBeenCalledWith("execution-api", { collected: true }, 150);
	});

	it("reconciles completion through the BullMQ job ID when job data was not persisted", async () => {
		mocks.getJobExecutionByBullmqJobId.mockResolvedValueOnce({ id: "execution-existing" });
		const job = {
			id: "cron-job-1",
			data: { type: "cron:telemetry", triggeredAt: "2026-07-10T08:00:00.000Z" },
			processedOn: 100,
			finishedOn: 250,
		} as unknown as Job<JobData, JobResult>;

		await reconcileCronJobCompletion(job, {
			success: true,
			data: { collected: true },
		});

		expect(mocks.markJobCompleted).toHaveBeenCalledWith(
			"execution-existing",
			{ collected: true },
			150,
		);
	});

	it("best-effort completion reconciliation logs tracking failures", async () => {
		const trackingError = new Error("database unavailable");
		mocks.markJobCompleted.mockRejectedValueOnce(trackingError);
		const job = {
			id: "cron-job-1",
			data: {
				type: "cron:telemetry",
				triggeredAt: "2026-07-10T08:00:00.000Z",
				executionId: "execution-api",
			},
		} as unknown as Job<JobData, JobResult>;

		await expect(
			reconcileCronJobCompletion(job, { success: true, data: { collected: true } }),
		).resolves.toBeUndefined();
		expect(mocks.loggerError).toHaveBeenCalledWith(
			expect.objectContaining({ error: trackingError, jobId: "cron-job-1" }),
			"Failed to reconcile completed cron job",
		);
	});

	it("reconciles a definitive BullMQ failure through the job ID", async () => {
		mocks.getJobExecutionByBullmqJobId.mockResolvedValueOnce({ id: "execution-existing" });
		const job = {
			id: "cron-job-1",
			data: { type: "cron:telemetry", triggeredAt: "2026-07-10T08:00:00.000Z" },
			processedOn: 100,
			finishedOn: 300,
			getState: vi.fn().mockResolvedValue("failed"),
		} as unknown as Job<JobData, JobResult>;
		const processorError = new Error("job stalled more than allowable limit");

		await reconcileCronJobFailure(job, processorError);

		expect(mocks.markJobFailed).toHaveBeenCalledWith(
			"execution-existing",
			processorError.message,
			200,
		);
	});

	it("does not mark an intermediate failed attempt terminal", async () => {
		const job = {
			id: "cron-job-1",
			data: {
				type: "cron:telemetry",
				triggeredAt: "2026-07-10T08:00:00.000Z",
				executionId: "execution-api",
			},
			getState: vi.fn().mockResolvedValue("delayed"),
		} as unknown as Job<JobData, JobResult>;

		await reconcileCronJobFailure(job, new Error("temporary failure"));

		expect(mocks.markJobFailed).not.toHaveBeenCalled();
	});

	it("best-effort failed reconciliation swallows tracking failures", async () => {
		const trackingError = new Error("database unavailable");
		mocks.markJobFailed.mockRejectedValueOnce(trackingError);
		const job = {
			id: "cron-job-1",
			data: {
				type: "cron:telemetry",
				triggeredAt: "2026-07-10T08:00:00.000Z",
				executionId: "execution-api",
			},
			getState: vi.fn().mockResolvedValue("failed"),
		} as unknown as Job<JobData, JobResult>;

		await expect(
			reconcileCronJobFailure(job, new Error("processor failed")),
		).resolves.toBeUndefined();
		expect(mocks.loggerError).toHaveBeenCalledWith(
			expect.objectContaining({ error: trackingError, jobId: "cron-job-1" }),
			"Failed to reconcile failed cron job",
		);
	});

	it("registers completed and failed reconciliation listeners", () => {
		const worker = {
			on: vi.fn(),
		};

		registerCronTrackingListeners(worker as Parameters<typeof registerCronTrackingListeners>[0]);

		expect(worker.on).toHaveBeenCalledWith("completed", expect.any(Function));
		expect(worker.on).toHaveBeenCalledWith("failed", expect.any(Function));
	});
});
