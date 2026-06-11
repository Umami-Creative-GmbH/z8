import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/db", () => ({
	db: { execute: vi.fn() },
}));

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "test-bucket",
	s3Client: { send: vi.fn() },
}));

const ping = vi.fn();

vi.mock("@/lib/redis", () => ({
	redis: { ping },
}));

describe("health Redis checks", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("cache health check fails fast when Redis ping never resolves", async () => {
		ping.mockReturnValue(new Promise(() => {}));
		const { checkCache } = await import("./health");

		const settled = vi.fn();
		void checkCache().then(settled);

		await vi.advanceTimersByTimeAsync(1_100);

		expect(settled).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "degraded",
				error: "Redis health check timed out",
			}),
		);
	});
});
