import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanupOldExecutionsMock = vi.fn();

vi.mock("@/lib/cron/tracking", () => ({
	cleanupOldExecutions: cleanupOldExecutionsMock,
}));

vi.mock("@/env", () => ({
	env: { JOB_EXECUTION_RETENTION_DAYS: "45" },
}));

beforeEach(() => {
	cleanupOldExecutionsMock.mockReset();
});

describe("runExecutionCleanup", () => {
	it("uses the configured retention period and returns cleanup metadata", async () => {
		cleanupOldExecutionsMock.mockResolvedValue(12);

		const { runExecutionCleanup } = await import("./execution-cleanup");
		const result = await runExecutionCleanup();

		expect(cleanupOldExecutionsMock).toHaveBeenCalledWith(45);
		expect(result).toEqual({ success: true, deletedCount: 12, daysToKeep: 45 });
	});
});
