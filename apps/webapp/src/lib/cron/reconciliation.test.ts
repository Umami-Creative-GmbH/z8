import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileCronJobSchedule, reconcileCronSchedules, retireLegacyEscalationSchedulers } from "./reconciliation";

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
	afterEach(() => vi.unstubAllEnvs());

	it("explicitly retires legacy schedulers instead of recreating them during reconciliation", async () => {
		vi.stubEnv("RETIRE_LEGACY_ESCALATION_SCHEDULERS", "true");
		const fakeQueue = { ...queue(), removeJobScheduler: vi.fn().mockResolvedValue(true) };
		const result = await reconcileCronSchedules({
			queue: fakeQueue as never,
			schedules: {
				"cron:slack-escalation": { pattern: "*/30 * * * *" },
				"cron:telegram-escalation": { pattern: "*/30 * * * *" },
				"cron:discord-escalation": { pattern: "*/30 * * * *" },
				"cron:teams-escalation": { pattern: "*/30 * * * *" },
				"cron:export": { pattern: "0 * * * *" },
			} as never,
		});
		expect(fakeQueue.removeJobScheduler.mock.calls).toEqual([
			["cron-cron:slack-escalation"],
			["cron-cron:telegram-escalation"],
			["cron-cron:discord-escalation"],
			["cron-cron:teams-escalation"],
		]);
		expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledTimes(1);
		expect(result.failed).toEqual([]);
	});

	it("can retire without registering schedules, accepts already-absent schedulers and surfaces Redis failures", async () => {
		vi.stubEnv("RETIRE_LEGACY_ESCALATION_SCHEDULERS", "true");
		const fakeQueue = {
			...queue(),
			removeJobScheduler: vi.fn().mockResolvedValue(false)
				.mockRejectedValueOnce(new Error("Redis unavailable")),
		};
		const results = await retireLegacyEscalationSchedulers(fakeQueue as never);
		expect(results).toEqual([
			{ jobName: "cron:teams-escalation", result: { success: false, error: "Redis unavailable" } },
			{ jobName: "cron:telegram-escalation", result: { success: true, retired: true } },
			{ jobName: "cron:discord-escalation", result: { success: true, retired: true } },
			{ jobName: "cron:slack-escalation", result: { success: true, retired: true } },
		]);
		expect(fakeQueue.upsertJobScheduler).not.toHaveBeenCalled();
		// Retrying recovers partial retirement without deleting queued jobs.
		expect((await retireLegacyEscalationSchedulers(fakeQueue as never)).every(({ result }) => result.success)).toBe(true);
	});

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
