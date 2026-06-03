import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/effect/errors";
import { buildAvailableJobNames, isVisibleCronJobName, mapCronExecution } from "./actions-helpers";

const mocks = vi.hoisted(() => ({
	getAllJobMetrics: vi.fn(),
	getExecutionsSince: vi.fn(),
	getJobExecutionHistory: vi.fn(),
	getJobQueue: vi.fn(),
	getRecentExecutions: vi.fn(),
	isQueueHealthy: vi.fn(),
	deleteCronScheduleOverride: vi.fn(),
	listCronScheduleOverrides: vi.fn(),
	logAction: vi.fn(),
	reconcileCronJobSchedule: vi.fn(),
	requirePlatformAdmin: vi.fn(),
	upsertCronScheduleOverride: vi.fn(),
}));

vi.mock("@/lib/cron/tracking", () => ({
	getAllJobMetrics: mocks.getAllJobMetrics,
	getExecutionsSince: mocks.getExecutionsSince,
	getJobExecutionHistory: mocks.getJobExecutionHistory,
	getRecentExecutions: mocks.getRecentExecutions,
}));

vi.mock("@/lib/cron/schedule-overrides", () => ({
	deleteCronScheduleOverride: mocks.deleteCronScheduleOverride,
	listCronScheduleOverrides: mocks.listCronScheduleOverrides,
	upsertCronScheduleOverride: mocks.upsertCronScheduleOverride,
}));

vi.mock("@/lib/cron/reconciliation", () => ({
	reconcileCronJobSchedule: mocks.reconcileCronJobSchedule,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { PlatformAdminService } = await import("@/lib/effect/services/platform-admin.service");

	return {
		AppLayer: Layer.succeed(PlatformAdminService, {
			logAction: mocks.logAction,
			requirePlatformAdmin: mocks.requirePlatformAdmin,
		} as never),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T, E, R>(effect: Effect.Effect<T, E, R>) => {
			const exit = await Effect.runPromiseExit(effect as Effect.Effect<T, E, never>);

			return Exit.match(exit, {
				onFailure: (cause) => {
					const defect = [...Cause.defects(cause)][0] ?? null;
					const failure = Option.getOrNull(Cause.failureOption(cause));
					const error = defect ?? failure ?? cause;

					if (error && typeof error === "object" && "_tag" in error) {
						return {
							success: false as const,
							error: (error as { message: string }).message,
							code: (error as { _tag: string })._tag,
						};
					}

					return {
						success: false as const,
						error: error instanceof Error ? error.message : "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				},
				onSuccess: (data) => ({ success: true as const, data }),
			});
		},
	};
});

vi.mock("@/lib/queue", () => ({
	getJobQueue: mocks.getJobQueue,
	isQueueHealthy: mocks.isQueueHealthy,
}));

import {
	getWorkerQueueJobExecutions,
	getWorkerQueueStats,
	resetCronSchedule,
	updateCronSchedule,
} from "./actions";

const executionRow = {
	id: "exec-1",
	jobName: "cron:export",
	status: "completed",
	startedAt: new Date("2026-05-20T10:00:00.000Z"),
	completedAt: new Date("2026-05-20T10:00:05.000Z"),
	durationMs: 5000,
	error: null,
};

beforeEach(() => {
	mocks.getAllJobMetrics.mockReset();
	mocks.getExecutionsSince.mockReset();
	mocks.getJobExecutionHistory.mockReset();
	mocks.getJobQueue.mockReset();
	mocks.getRecentExecutions.mockReset();
	mocks.isQueueHealthy.mockReset();
	mocks.deleteCronScheduleOverride.mockReset();
	mocks.listCronScheduleOverrides.mockReset();
	mocks.logAction.mockReset();
	mocks.reconcileCronJobSchedule.mockReset();
	mocks.requirePlatformAdmin.mockReset();
	mocks.upsertCronScheduleOverride.mockReset();
	mocks.deleteCronScheduleOverride.mockResolvedValue(undefined);
	mocks.getAllJobMetrics.mockResolvedValue([]);
	mocks.getExecutionsSince.mockResolvedValue([]);
	mocks.getJobQueue.mockReturnValue({ queue: true });
	mocks.getRecentExecutions.mockResolvedValue([]);
	mocks.isQueueHealthy.mockResolvedValue(false);
	mocks.listCronScheduleOverrides.mockResolvedValue([]);
	mocks.logAction.mockReturnValue(Effect.succeed(undefined));
	mocks.reconcileCronJobSchedule.mockResolvedValue({ success: true, removedCount: 0 });
	mocks.requirePlatformAdmin.mockReturnValue(
		Effect.succeed({ userId: "platform-admin-1", email: "admin@example.com" }),
	);
	mocks.upsertCronScheduleOverride.mockResolvedValue({
		jobName: "cron:export",
		presetId: "hourly",
		pattern: "0 * * * *",
		updatedBy: "platform-admin-1",
	});
});

describe("worker queue action helpers", () => {
	it("accepts visible cron jobs and rejects hidden or non-cron names", () => {
		expect(isVisibleCronJobName("cron:export")).toBe(true);
		expect(isVisibleCronJobName("cron:telemetry")).toBe(false);
		expect(isVisibleCronJobName("cron:not-real")).toBe(false);
		expect(isVisibleCronJobName("email:send")).toBe(false);
		expect(isVisibleCronJobName("")).toBe(false);
	});

	it("maps cron execution rows into serializable recent executions", () => {
		expect(
			mapCronExecution({
				id: "exec-1",
				jobName: "cron:export",
				status: "completed",
				startedAt: new Date("2026-05-20T10:00:00.000Z"),
				completedAt: new Date("2026-05-20T10:00:05.000Z"),
				durationMs: 5000,
				error: null,
			}),
		).toEqual({
			id: "exec-1",
			jobName: "cron:export",
			status: "completed",
			startedAt: "2026-05-20T10:00:00.000Z",
			completedAt: "2026-05-20T10:00:05.000Z",
			durationMs: 5000,
			error: null,
		});
	});

	it("builds sorted visible job names from all worker queue sources", () => {
		expect(
			buildAvailableJobNames({
				repeatableJobs: [{ name: "cron:work-balance" }, { name: "cron:telemetry" }],
				recentExecutions: [{ jobName: "cron:export" }, { jobName: "email:send" }],
				jobMetrics: [{ jobName: "cron:organization-cleanup" }],
				reliabilityJobs: [{ jobName: "cron:work-balance" }, { jobName: "cron:scheduled-exports" }],
			}),
		).toEqual([
			"cron:export",
			"cron:organization-cleanup",
			"cron:scheduled-exports",
			"cron:work-balance",
		]);
	});
});

describe("getWorkerQueueStats", () => {
	it("includes visible scheduled cron rows with override mismatch status", async () => {
		mocks.isQueueHealthy.mockResolvedValue(true);
		mocks.getJobQueue.mockReturnValue({
			getJobCounts: vi.fn().mockResolvedValue({}),
			getRepeatableJobs: vi.fn().mockResolvedValue([
				{
					name: "cron:export",
					pattern: "*/5 * * * *",
					next: Date.parse("2026-06-03T12:05:00.000Z"),
				},
				{
					name: "cron:telemetry",
					pattern: "* * * * *",
					next: Date.parse("2026-06-03T12:01:00.000Z"),
				},
			]),
		});
		mocks.listCronScheduleOverrides.mockResolvedValue([
			{
				jobName: "cron:export",
				presetId: "hourly",
				pattern: "0 * * * *",
			},
		]);

		const result = await getWorkerQueueStats();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.scheduledJobs).toContainEqual(
			expect.objectContaining({
				name: "cron:export",
				effectivePattern: "0 * * * *",
				isOverridden: true,
				hasScheduleMismatch: true,
			}),
		);
		expect(result.data.scheduledJobs.some((job) => job.name === "cron:telemetry")).toBe(false);
	});
});

describe("getWorkerQueueJobExecutions", () => {
	it("requires platform-admin authorization before fetching selected job executions", async () => {
		mocks.getJobExecutionHistory.mockResolvedValue([]);

		await getWorkerQueueJobExecutions("cron:export");

		expect(mocks.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mocks.getJobExecutionHistory).toHaveBeenCalledTimes(1);
	});

	it("fetches the selected visible job history with the recent execution limit", async () => {
		mocks.getJobExecutionHistory.mockResolvedValue([executionRow]);

		const result = await getWorkerQueueJobExecutions("cron:export");

		expect(mocks.getJobExecutionHistory).toHaveBeenCalledWith("cron:export", 50);
		expect(result).toEqual({
			success: true,
			data: [
				{
					id: "exec-1",
					jobName: "cron:export",
					status: "completed",
					startedAt: "2026-05-20T10:00:00.000Z",
					completedAt: "2026-05-20T10:00:05.000Z",
					durationMs: 5000,
					error: null,
				},
			],
		});
	});

	it("rejects hidden jobs before querying execution history", async () => {
		const result = await getWorkerQueueJobExecutions("cron:telemetry");

		expect(mocks.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mocks.getJobExecutionHistory).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid cron job name",
		});
	});

	it("rejects unknown cron-looking jobs before querying execution history", async () => {
		const result = await getWorkerQueueJobExecutions("cron:not-real");

		expect(mocks.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mocks.getJobExecutionHistory).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid cron job name",
		});
	});

	it("does not query execution history when platform-admin authorization fails", async () => {
		mocks.requirePlatformAdmin.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message: "Platform admin access required",
					action: "read",
					resource: "worker-queue",
				}),
			),
		);

		const result = await getWorkerQueueJobExecutions("cron:export");

		expect(mocks.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mocks.getJobExecutionHistory).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});
});

describe("cron schedule mutations", () => {
	it("upserts a low-risk schedule override, reconciles immediately, and audits the update", async () => {
		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "hourly" });

		expect(result).toEqual({
			success: true,
			data: { immediateReconciled: true, warning: null },
		});
		expect(mocks.upsertCronScheduleOverride).toHaveBeenCalledWith({
			jobName: "cron:export",
			presetId: "hourly",
			pattern: "0 * * * *",
			updatedBy: "platform-admin-1",
		});
		expect(mocks.deleteCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.reconcileCronJobSchedule).toHaveBeenCalledWith({
			queue: { queue: true },
			jobName: "cron:export",
			pattern: "0 * * * *",
		});
		expect(mocks.logAction).toHaveBeenCalledWith(
			"platform-admin-1",
			"update_cron_schedule",
			"cron_job",
			"cron:export",
			expect.objectContaining({
				oldPattern: "*/5 * * * *",
				newPattern: "0 * * * *",
				presetId: "hourly",
				immediateReconciled: true,
				reconciliationError: null,
			}),
		);
	});

	it("rejects hidden cron jobs before persistence or reconciliation", async () => {
		const result = await updateCronSchedule({ jobName: "cron:telemetry", presetId: "hourly" });

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid cron job name",
		});
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.deleteCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.reconcileCronJobSchedule).not.toHaveBeenCalled();
	});

	it("rejects high-risk schedule updates without confirmation before persistence or reconciliation", async () => {
		const result = await updateCronSchedule({
			jobName: "cron:billing-seat-reconciliation",
			presetId: "daily-midnight",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "High-risk cron schedule changes require confirmation",
		});
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.deleteCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.reconcileCronJobSchedule).not.toHaveBeenCalled();
	});

	it("returns success with warning when reconciliation fails after saving", async () => {
		mocks.reconcileCronJobSchedule.mockResolvedValue({
			success: false,
			removedCount: 0,
			error: "Redis unavailable",
		});

		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "hourly" });

		expect(result).toEqual({
			success: true,
			data: { immediateReconciled: false, warning: "Redis unavailable" },
		});
		expect(mocks.upsertCronScheduleOverride).toHaveBeenCalledTimes(1);
		expect(mocks.logAction).toHaveBeenCalledWith(
			"platform-admin-1",
			"update_cron_schedule",
			"cron_job",
			"cron:export",
			expect.objectContaining({
				immediateReconciled: false,
				reconciliationError: "Redis unavailable",
			}),
		);
	});

	it("audits update oldPattern from an existing override", async () => {
		mocks.listCronScheduleOverrides.mockResolvedValue([
			{
				jobName: "cron:export",
				presetId: "every-30-minutes",
				pattern: "*/30 * * * *",
			},
		]);

		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "hourly" });

		expect(result.success).toBe(true);
		expect(mocks.logAction).toHaveBeenCalledWith(
			"platform-admin-1",
			"update_cron_schedule",
			"cron_job",
			"cron:export",
			expect.objectContaining({
				oldPattern: "*/30 * * * *",
				newPattern: "0 * * * *",
				presetId: "hourly",
			}),
		);
	});

	it("deletes an override, reconciles the default pattern, and audits reset", async () => {
		const result = await resetCronSchedule({ jobName: "cron:export" });

		expect(result).toEqual({
			success: true,
			data: { immediateReconciled: true, warning: null },
		});
		expect(mocks.deleteCronScheduleOverride).toHaveBeenCalledWith("cron:export");
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.reconcileCronJobSchedule).toHaveBeenCalledWith({
			queue: { queue: true },
			jobName: "cron:export",
			pattern: "*/5 * * * *",
		});
		expect(mocks.logAction).toHaveBeenCalledWith(
			"platform-admin-1",
			"reset_cron_schedule",
			"cron_job",
			"cron:export",
			expect.objectContaining({
				oldPattern: "*/5 * * * *",
				newPattern: "*/5 * * * *",
				immediateReconciled: true,
				reconciliationError: null,
			}),
		);
	});

	it("audits reset oldPattern from an existing override", async () => {
		mocks.listCronScheduleOverrides.mockResolvedValue([
			{
				jobName: "cron:export",
				presetId: "every-30-minutes",
				pattern: "*/30 * * * *",
			},
		]);

		const result = await resetCronSchedule({ jobName: "cron:export" });

		expect(result.success).toBe(true);
		expect(mocks.logAction).toHaveBeenCalledWith(
			"platform-admin-1",
			"reset_cron_schedule",
			"cron_job",
			"cron:export",
			expect.objectContaining({
				oldPattern: "*/30 * * * *",
				newPattern: "*/5 * * * *",
			}),
		);
	});

	it("rejects invalid schedule presets", async () => {
		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "not-real" });

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid cron schedule preset",
		});
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.reconcileCronJobSchedule).not.toHaveBeenCalled();
	});

	it("does not persist or reconcile when authorization fails", async () => {
		mocks.requirePlatformAdmin.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message: "Platform admin access required",
					action: "update",
					resource: "worker-queue",
				}),
			),
		);

		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "hourly" });

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.deleteCronScheduleOverride).not.toHaveBeenCalled();
		expect(mocks.reconcileCronJobSchedule).not.toHaveBeenCalled();
	});
});
