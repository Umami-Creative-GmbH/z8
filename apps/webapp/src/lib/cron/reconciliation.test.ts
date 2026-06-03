import { describe, expect, it, vi } from "vitest";
import { reconcileCronJobSchedule, reconcileCronSchedules } from "./reconciliation";

function queue(overrides?: {
	repeatables?: Array<{ name: string; pattern?: string; key?: string }>;
	removeRejects?: boolean;
	addRejects?: boolean;
}) {
	return {
		getRepeatableJobs: vi
			.fn()
			.mockResolvedValue(
				overrides?.repeatables ?? [
					{ name: "cron:export", pattern: "*/5 * * * *", key: "repeat-key-export-old" },
				],
			),
		removeRepeatableByKey: vi.fn((key: string) => {
			if (overrides?.removeRejects) {
				return Promise.reject(new Error(`remove failed ${key}`));
			}
			return Promise.resolve();
		}),
		add: vi.fn(() => {
			if (overrides?.addRejects) {
				return Promise.reject(new Error("add failed"));
			}
			return Promise.resolve({ id: "job-1" });
		}),
	};
}

describe("cron schedule reconciliation", () => {
	it("removes stale repeatables and adds the effective schedule for one job", async () => {
		const fakeQueue = queue();

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(fakeQueue.removeRepeatableByKey).toHaveBeenCalledWith("repeat-key-export-old");
		expect(fakeQueue.add).toHaveBeenCalledWith(
			"cron:export",
			{ type: "cron:export", triggeredAt: expect.any(String) },
			expect.objectContaining({ repeat: { pattern: "0 * * * *" }, jobId: "cron-cron:export" }),
		);
		expect(result).toEqual({ success: true, removedCount: 1 });
	});

	it("reports a failed add without throwing", async () => {
		const fakeQueue = queue({ addRejects: true });

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("add failed");
	});

	it("does not remove stale repeatables when adding the desired schedule fails", async () => {
		const fakeQueue = queue({ addRejects: true });

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(result.success).toBe(false);
		expect(fakeQueue.removeRepeatableByKey).not.toHaveBeenCalled();
	});

	it("does not add or remove when the desired schedule already exists", async () => {
		const fakeQueue = queue({
			repeatables: [{ name: "cron:export", pattern: "0 * * * *", key: "repeat-key-export" }],
		});

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(fakeQueue.add).not.toHaveBeenCalled();
		expect(fakeQueue.removeRepeatableByKey).not.toHaveBeenCalled();
		expect(result).toEqual({ success: true, removedCount: 0 });
	});

	it("removes only stale repeatables when the desired schedule already exists", async () => {
		const fakeQueue = queue({
			repeatables: [
				{ name: "cron:export", pattern: "0 * * * *", key: "repeat-key-export" },
				{ name: "cron:export", pattern: "*/5 * * * *", key: "repeat-key-export-old" },
			],
		});

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(fakeQueue.add).not.toHaveBeenCalled();
		expect(fakeQueue.removeRepeatableByKey).toHaveBeenCalledOnce();
		expect(fakeQueue.removeRepeatableByKey).toHaveBeenCalledWith("repeat-key-export-old");
		expect(result).toEqual({ success: true, removedCount: 1 });
	});

	it("reconciles all provided schedules", async () => {
		const fakeQueue = queue({ repeatables: [] });

		const result = await reconcileCronSchedules({
			queue: fakeQueue as never,
			schedules: {
				"cron:export": { pattern: "*/5 * * * *" },
				"cron:vacation": { pattern: "0 0 * * *" },
			} as never,
		});

		expect(fakeQueue.add).toHaveBeenCalledTimes(2);
		expect(result.failed).toEqual([]);
	});
});
