import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanupOldExecutionsMock = vi.fn();

vi.mock("@/lib/cron/tracking", () => ({
	cleanupOldExecutions: cleanupOldExecutionsMock,
}));

beforeEach(() => {
	cleanupOldExecutionsMock.mockReset();
});

describe("runExecutionCleanup", () => {
	it("deletes executions older than 90 days and returns cleanup metadata", async () => {
		cleanupOldExecutionsMock.mockResolvedValue(12);

		const { runExecutionCleanup } = await import("./execution-cleanup");
		const result = await runExecutionCleanup();

		expect(cleanupOldExecutionsMock).toHaveBeenCalledWith(90);
		expect(result).toEqual({ success: true, deletedCount: 12, daysToKeep: 90 });
	});
});
