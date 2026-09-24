/**
 * Redis contract for legacy escalation scheduler retirement. Opt-in: point
 * LEGACY_ESCALATION_REDIS_TEST_URL at a disposable loopback Redis/Valkey, e.g.
 *
 *   docker run -d --rm --name z8-t271-valkey --label z8.agent-owned=legacy-escalation-redis-test \
 *     -p 127.0.0.1:6399:6379 valkey/valkey:8
 *   LEGACY_ESCALATION_REDIS_TEST_URL=redis://127.0.0.1:6399 \
 *     pnpm --filter webapp exec vitest run src/lib/cron/legacy-escalation-schedulers.redis.integration.test.ts
 *
 * Uses a unique queue name and obliterates it afterwards.
 */
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { LEGACY_ESCALATION_JOB_NAMES } from "./legacy-escalation-schedulers";
import { reconcileCronJobSchedule, reconcileCronSchedules, retireLegacyEscalationSchedulers } from "./reconciliation";
import { CRON_JOBS, type CronJobName } from "./registry";

const mockEnv = vi.hoisted(() => ({
	RETIRE_LEGACY_ESCALATION_SCHEDULERS: undefined as "true" | "false" | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

const redisUrl = process.env.LEGACY_ESCALATION_REDIS_TEST_URL;
if (redisUrl && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(redisUrl).hostname)) {
	throw new Error("LEGACY_ESCALATION_REDIS_TEST_URL must use a loopback host");
}

const retainedJob = "cron:export" satisfies CronJobName;
const schedules = Object.fromEntries(
	[...LEGACY_ESCALATION_JOB_NAMES, retainedJob].map((jobName) => [jobName, { pattern: CRON_JOBS[jobName].schedule }]),
) as Record<CronJobName, { pattern: string }>;
const legacySchedulerKeys = LEGACY_ESCALATION_JOB_NAMES.map((jobName) => `cron-${jobName}`).sort();

describe.skipIf(!redisUrl)("legacy escalation scheduler retirement (isolated Redis)", () => {
	const url = new URL(redisUrl ?? "redis://127.0.0.1:6379");
	const connection = { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null };
	const queue = new Queue(`t271-legacy-escalation-${randomUUID()}`, { connection });

	async function schedulerKeys() {
		return (await queue.getJobSchedulers()).map((scheduler) => scheduler.key).sort();
	}

	afterEach(() => {
		mockEnv.RETIRE_LEGACY_ESCALATION_SCHEDULERS = undefined;
	});

	afterAll(async () => {
		await queue.obliterate({ force: true });
		await queue.close();
	});

	it("removes only legacy schedulers, keeps them absent across reconciliation, and leaves queued names consumable", async () => {
		expect((await reconcileCronSchedules({ queue, schedules })).failed).toEqual([]);
		expect(await schedulerKeys()).toEqual([...legacySchedulerKeys, `cron-${retainedJob}`].sort());

		// A surviving manual/queued job under a legacy name, enqueued before retirement.
		const queued = await queue.add("cron:slack-escalation", {
			type: "cron:slack-escalation",
			triggeredAt: new Date().toISOString(),
		});

		mockEnv.RETIRE_LEGACY_ESCALATION_SCHEDULERS = "true";
		const retirement = await retireLegacyEscalationSchedulers(queue);
		expect(retirement.map(({ result }) => result)).toEqual(
			LEGACY_ESCALATION_JOB_NAMES.map(() => ({ success: true, retired: true })),
		);
		expect(await schedulerKeys()).toEqual([`cron-${retainedJob}`]);
		const pendingLegacyRuns = (await queue.getDelayed()).filter((job) =>
			(LEGACY_ESCALATION_JOB_NAMES as readonly string[]).includes(job.name),
		);
		expect(pendingLegacyRuns).toEqual([]);

		// Worker restart / platform-admin reconciliation must not recreate them.
		const restart = await reconcileCronSchedules({ queue, schedules });
		expect(restart.retired.map(({ jobName }) => jobName).sort()).toEqual([...LEGACY_ESCALATION_JOB_NAMES].sort());
		expect(restart.reconciled).toEqual([{ jobName: retainedJob }]);
		expect(
			await reconcileCronJobSchedule({ queue, jobName: "cron:teams-escalation", pattern: "*/5 * * * *" }),
		).toEqual({ success: true, retired: true });
		expect(await schedulerKeys()).toEqual([`cron-${retainedJob}`]);

		// Already-absent retirement is successful.
		expect((await retireLegacyEscalationSchedulers(queue)).every(({ result }) => result.success)).toBe(true);

		// Scheduler removal does not drain queued work: the old job name is still consumed.
		expect(await queued.getState()).toBe("waiting");
		const consumed = new Promise<string>((resolve) => {
			const worker = new Worker(
				queue.name,
				async (job) => {
					resolve(job.name);
					return { success: true };
				},
				{ connection },
			);
			worker.on("completed", () => void worker.close());
		});
		expect(await consumed).toBe("cron:slack-escalation");
	});

	it("is recreated by any process whose retirement setting is off", async () => {
		mockEnv.RETIRE_LEGACY_ESCALATION_SCHEDULERS = "true";
		await retireLegacyEscalationSchedulers(queue);
		expect(await schedulerKeys()).not.toContain("cron-cron:slack-escalation");

		// Fleet-wide configuration is required: a divergent process reinstalls the scheduler.
		mockEnv.RETIRE_LEGACY_ESCALATION_SCHEDULERS = undefined;
		await reconcileCronJobSchedule({ queue, jobName: "cron:slack-escalation", pattern: "*/30 * * * *" });
		expect(await schedulerKeys()).toContain("cron-cron:slack-escalation");
	});
});
