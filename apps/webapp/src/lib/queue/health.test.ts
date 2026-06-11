import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getJobCounts = vi.fn();
const queueConstructor = vi.fn(function QueueMock() {
	return { getJobCounts };
});

vi.mock("bullmq", () => ({
	Queue: queueConstructor,
	Worker: vi.fn(),
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

		await vi.advanceTimersByTimeAsync(1_100);

		expect(getJobCounts).toHaveBeenCalledTimes(1);
		expect(settled).toHaveBeenCalledWith(false);
		expect(queueConstructor).toHaveBeenCalledTimes(1);
	});
});
