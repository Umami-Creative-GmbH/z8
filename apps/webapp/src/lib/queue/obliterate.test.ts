import { describe, expect, test, vi } from "vitest";
import { obliterateJobQueue } from "./obliterate";

function createQueue() {
	return {
		obliterate: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

describe("obliterateJobQueue", () => {
	test("rejects an invalid confirmation without obliterating and closes the queue", async () => {
		const queue = createQueue();

		await expect(obliterateJobQueue(queue, "wrong-queue")).rejects.toThrowError(
			/^Confirmation must equal "z8-jobs"$/,
		);

		expect(queue.obliterate).not.toHaveBeenCalled();
		expect(queue.close).toHaveBeenCalledTimes(1);
	});

	test("force obliterates the queue for the exact confirmation and closes it", async () => {
		const queue = createQueue();

		await obliterateJobQueue(queue, "z8-jobs");

		expect(queue.obliterate).toHaveBeenCalledExactlyOnceWith({ force: true });
		expect(queue.close).toHaveBeenCalledTimes(1);
	});

	test("propagates obliterate failures and still closes the queue", async () => {
		const queue = createQueue();
		const error = new Error("Redis unavailable");
		queue.obliterate.mockRejectedValue(error);

		await expect(obliterateJobQueue(queue, "z8-jobs")).rejects.toBe(error);

		expect(queue.close).toHaveBeenCalledTimes(1);
	});

	test("retains the obliterate failure when closing also fails", async () => {
		const queue = createQueue();
		const operationError = new Error("redis unavailable");
		queue.obliterate.mockRejectedValue(operationError);
		queue.close.mockRejectedValue(new Error("close failed"));

		let rejection: unknown;
		try {
			await obliterateJobQueue(queue, "z8-jobs");
		} catch (error) {
			rejection = error;
		}

		expect(rejection).toBeInstanceOf(Error);
		expect((rejection as Error).message).toContain("redis unavailable");
		expect((rejection as Error & { cause?: unknown }).cause).toBe(
			operationError,
		);
		expect(queue.close).toHaveBeenCalledTimes(1);
	});

	test("reports that obliteration succeeded when closing fails", async () => {
		const queue = createQueue();
		const closeError = new Error("close failed");
		queue.close.mockRejectedValue(closeError);

		let rejection: unknown;
		try {
			await obliterateJobQueue(queue, "z8-jobs");
		} catch (error) {
			rejection = error;
		}

		expect(rejection).toBeInstanceOf(Error);
		expect((rejection as Error).message).toBe(
			'Queue "z8-jobs" was obliterated, but closing its connection failed',
		);
		expect((rejection as Error & { cause?: unknown }).cause).toBe(closeError);
		expect(queue.obliterate).toHaveBeenCalledExactlyOnceWith({ force: true });
	});
});
