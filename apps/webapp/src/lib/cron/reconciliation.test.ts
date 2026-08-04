import { describe, expect, it, vi } from "vitest";
import { reconcileCronJobSchedule, reconcileCronSchedules } from "./reconciliation";

function queue(overrides?: { upsertRejects?: boolean }) {
	return {
		upsertJobScheduler: vi.fn(() => {
			if (overrides?.upsertRejects) {
				return Promise.reject(new Error("upsert failed"));
			}
			return Promise.resolve({ id: "cron-cron:export" });
		}),
	};
}

describe("cron schedule reconciliation", () => {
	it("upserts the effective schedule for one job", async () => {
		const fakeQueue = queue();

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledWith(
			"cron-cron:export",
			{ pattern: "0 * * * *" },
			{
				name: "cron:export",
				data: { type: "cron:export", triggeredAt: expect.any(String) },
				opts: {
					attempts: 3,
					priority: 3,
					removeOnComplete: { count: 50, age: 86400 },
					removeOnFail: { count: 100, age: 604800 },
				},
			},
		);
		expect(result).toEqual({ success: true });
	});

	it("reports a failed upsert without throwing", async () => {
		const fakeQueue = queue({ upsertRejects: true });

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("upsert failed");
	});

	it("reconciles all provided schedules", async () => {
		const fakeQueue = queue();

		const result = await reconcileCronSchedules({
			queue: fakeQueue as never,
			schedules: {
				"cron:export": { pattern: "*/5 * * * *" },
				"cron:vacation": { pattern: "0 0 * * *" },
			} as never,
		});

		expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
		expect(result).toEqual({
			reconciled: [{ jobName: "cron:export" }, { jobName: "cron:vacation" }],
			failed: [],
		});
	});
});
