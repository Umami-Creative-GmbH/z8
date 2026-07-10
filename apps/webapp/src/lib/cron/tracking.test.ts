import { beforeEach, describe, expect, it, vi } from "vitest";
import { cronJobExecution } from "@/db/schema/cron-job";

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		transaction: mocks.transaction,
		query: {
			cronJobExecution: {
				findFirst: mocks.findFirst,
			},
		},
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
	}),
}));

const { getJobExecutionByBullmqJobId, getOrCreateSchedulerJobExecution } = await import(
	"./tracking"
);

describe("getJobExecutionByBullmqJobId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the execution correlated to a BullMQ job ID", async () => {
		const execution = { id: "execution-existing", bullmqJobId: "bull-job-1" };
		mocks.findFirst.mockResolvedValueOnce(execution);

		await expect(getJobExecutionByBullmqJobId("bull-job-1")).resolves.toBe(execution);
		expect(mocks.findFirst).toHaveBeenCalledWith({ where: expect.anything() });
		expect(mocks.findFirst.mock.calls[0]?.[0].where.queryChunks).toContain(
			cronJobExecution.bullmqJobId,
		);
	});

	it("returns undefined when no execution is correlated", async () => {
		mocks.findFirst.mockResolvedValueOnce(null);

		await expect(getJobExecutionByBullmqJobId("missing-job")).resolves.toBeUndefined();
	});
});

describe("getOrCreateSchedulerJobExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("locks before lookup and inserts one scheduler execution when absent", async () => {
		const operations: string[] = [];
		const returning = vi.fn().mockResolvedValue([{ id: "execution-created" }]);
		const values = vi.fn((_value) => {
			operations.push("insert");
			return { returning };
		});
		const tx = {
			execute: vi.fn(async () => {
				operations.push("lock");
			}),
			insert: vi.fn(() => ({ values })),
			query: {
				cronJobExecution: {
					findFirst: vi.fn(async () => {
						operations.push("lookup");
						return undefined;
					}),
				},
			},
		};
		mocks.transaction.mockImplementationOnce(async (callback) => callback(tx));

		await expect(
			getOrCreateSchedulerJobExecution({
				bullmqJobId: "bull-job-1",
				jobName: "cron:telemetry",
			}),
		).resolves.toBe("execution-created");

		expect(operations).toEqual(["lock", "lookup", "insert"]);
		const lockQuery = tx.execute.mock.calls[0]?.[0];
		expect(lockQuery.queryChunks[0].value).toEqual([
			"select pg_advisory_xact_lock(hashtextextended(",
		]);
		expect(lockQuery.queryChunks[1]).toBe("cron-job-execution:bull-job-1");
		expect(lockQuery.queryChunks[2].value).toEqual([", 0))"]);
		expect(lockQuery.shouldInlineParams).toBe(false);
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				bullmqJobId: "bull-job-1",
				jobName: "cron:telemetry",
				metadata: { source: "scheduler" },
				status: "pending",
			}),
		);
	});

	it("returns the existing execution under the lock without inserting", async () => {
		const existing = { id: "execution-existing", bullmqJobId: "bull-job-1" };
		const tx = {
			execute: vi.fn(),
			insert: vi.fn(),
			query: {
				cronJobExecution: {
					findFirst: vi.fn().mockResolvedValue(existing),
				},
			},
		};
		mocks.transaction.mockImplementationOnce(async (callback) => callback(tx));

		await expect(
			getOrCreateSchedulerJobExecution({
				bullmqJobId: "bull-job-1",
				jobName: "cron:telemetry",
			}),
		).resolves.toBe("execution-existing");

		expect(tx.execute).toHaveBeenCalledTimes(1);
		expect(tx.query.cronJobExecution.findFirst).toHaveBeenCalledTimes(1);
		expect(tx.insert).not.toHaveBeenCalled();
	});

	it("serializes concurrent callers so they share one inserted execution", async () => {
		let execution: { id: string; bullmqJobId: string } | undefined;
		let insertCount = 0;
		let lockTail = Promise.resolve();

		mocks.transaction.mockImplementation(async (callback) => {
			const previousLock = lockTail;
			let releaseLock = () => {};
			lockTail = new Promise<void>((resolve) => {
				releaseLock = resolve;
			});
			let acquiredLock = false;
			const tx = {
				execute: vi.fn(async () => {
					await previousLock;
					acquiredLock = true;
				}),
				insert: vi.fn(() => ({
					values: vi.fn((value: { bullmqJobId: string }) => ({
						returning: vi.fn(async () => {
							insertCount += 1;
							execution = { id: `execution-${insertCount}`, bullmqJobId: value.bullmqJobId };
							return [{ id: execution.id }];
						}),
					})),
				})),
				query: {
					cronJobExecution: {
						findFirst: vi.fn(async () => execution),
					},
				},
			};

			try {
				return await callback(tx);
			} finally {
				if (acquiredLock) {
					releaseLock();
				}
			}
		});

		const results = await Promise.all([
			getOrCreateSchedulerJobExecution({
				bullmqJobId: "bull-job-1",
				jobName: "cron:telemetry",
			}),
			getOrCreateSchedulerJobExecution({
				bullmqJobId: "bull-job-1",
				jobName: "cron:telemetry",
			}),
		]);

		expect(results).toEqual(["execution-1", "execution-1"]);
		expect(insertCount).toBe(1);
	});
});
