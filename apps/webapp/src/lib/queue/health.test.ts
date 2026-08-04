import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getJobCounts = vi.fn();
const queueConstructor = vi.fn(function QueueMock() {
	return { getJobCounts };
});

vi.mock("bullmq", () => ({
	Queue: queueConstructor,
	Worker: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		QUEUE_HEALTH_TIMEOUT_MS: "1750",
		QUEUE_JOB_ATTEMPTS: "4",
		QUEUE_JOB_BACKOFF_DELAY_MS: "1250",
		QUEUE_COMPLETED_JOB_RETENTION_COUNT: "120",
		QUEUE_COMPLETED_JOB_RETENTION_SECONDS: "90000",
		QUEUE_FAILED_JOB_RETENTION_COUNT: "520",
		QUEUE_FAILED_JOB_RETENTION_SECONDS: "610000",
	},
}));

describe("queue health", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.resetModules();
		Reflect.deleteProperty(globalThis, "jobQueue");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("returns false when BullMQ health check never resolves", async () => {
		getJobCounts.mockReturnValue(new Promise(() => {}));
		const { isQueueHealthy } = await import("./index");

		const settled = vi.fn();
		void isQueueHealthy().then(settled);

		await vi.advanceTimersByTimeAsync(1_749);
		expect(settled).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(getJobCounts).toHaveBeenCalledTimes(1);
		expect(settled).toHaveBeenCalledWith(false);
		expect(queueConstructor).toHaveBeenCalledTimes(1);
	});

	test("passes configured defaults and BullMQ connection requirements to the queue", async () => {
		const { getJobQueue } = await import("./index");

		getJobQueue();

		expect(queueConstructor).toHaveBeenCalledWith("z8-jobs", {
			connection: expect.objectContaining({ maxRetriesPerRequest: null }),
			defaultJobOptions: {
				attempts: 4,
				backoff: { type: "exponential", delay: 1_250 },
				removeOnComplete: { count: 120, age: 90_000 },
				removeOnFail: { count: 520, age: 610_000 },
			},
		});
	});
});
