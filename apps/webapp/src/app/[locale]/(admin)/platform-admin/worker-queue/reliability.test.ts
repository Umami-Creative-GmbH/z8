import { describe, expect, it } from "vitest";
import {
	buildReliabilityData,
	calculateSuccessRate,
	classifyJobHealth,
	inferStaleAfterMs,
	type ReliabilityExecution,
	type ReliabilityRepeatableJob,
} from "./reliability";

const now = new Date("2026-05-10T12:00:00.000Z");

function execution(
	overrides: Partial<ReliabilityExecution> &
		Pick<ReliabilityExecution, "id" | "status" | "startedAt">,
): ReliabilityExecution {
	return {
		jobName: "cron:export",
		completedAt: null,
		durationMs: null,
		...overrides,
	};
}

function repeatable(
	overrides: Partial<ReliabilityRepeatableJob> & Pick<ReliabilityRepeatableJob, "name" | "pattern">,
): ReliabilityRepeatableJob {
	return {
		next: null,
		...overrides,
	};
}

describe("worker queue reliability helpers", () => {
	it("calculates success rate from terminal executions only", () => {
		expect(calculateSuccessRate(3, 1)).toBe(75);
		expect(calculateSuccessRate(0, 0)).toBeNull();
	});

	it("infers stale thresholds for common cron patterns", () => {
		expect(inferStaleAfterMs("* * * * *")).toBe(10 * 60 * 1000);
		expect(inferStaleAfterMs("*/5 * * * *")).toBe(30 * 60 * 1000);
		expect(inferStaleAfterMs("*/15 * * * *")).toBe(90 * 60 * 1000);
		expect(inferStaleAfterMs("*/30 * * * *")).toBe(180 * 60 * 1000);
		expect(inferStaleAfterMs("0 * * * *")).toBe(3 * 60 * 60 * 1000);
		expect(inferStaleAfterMs("0 0 * * *")).toBe(36 * 60 * 60 * 1000);
		expect(inferStaleAfterMs("15 8 1 * *")).toBeNull();
	});

	it("prioritizes stale over failing and warning states", () => {
		expect(
			classifyJobHealth({
				successRate: 25,
				failedRuns: 3,
				terminalRuns: 4,
				isStale: true,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("stale");

		expect(
			classifyJobHealth({
				successRate: 79,
				failedRuns: 1,
				terminalRuns: 5,
				isStale: false,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("failing");

		expect(
			classifyJobHealth({
				successRate: 90,
				failedRuns: 1,
				terminalRuns: 10,
				isStale: false,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("warning");

		expect(
			classifyJobHealth({
				successRate: 100,
				failedRuns: 0,
				terminalRuns: 10,
				isStale: false,
				hasExecutions: true,
				hasKnownSchedule: true,
			}),
		).toBe("healthy");
	});

	it("builds daily outcome and duration buckets", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [
				execution({
					id: "run-1",
					status: "completed",
					startedAt: "2026-05-09T08:00:00.000Z",
					completedAt: "2026-05-09T08:00:03.000Z",
					durationMs: 3000,
				}),
				execution({
					id: "run-2",
					status: "failed",
					startedAt: "2026-05-09T09:00:00.000Z",
					completedAt: "2026-05-09T09:00:01.000Z",
					durationMs: 1000,
				}),
				execution({
					id: "run-3",
					status: "running",
					startedAt: "2026-05-09T10:00:00.000Z",
				}),
			],
			repeatableJobs: [repeatable({ name: "cron:export", pattern: "*/5 * * * *" })],
		});

		const may9 = reliability.outcomeSeries.find((point) => point.date === "2026-05-09");
		expect(may9).toMatchObject({ completed: 1, failed: 1, running: 1, successRate: 50 });

		const duration = reliability.durationSeries.find((point) => point.date === "2026-05-09");
		expect(duration).toMatchObject({ averageDurationMs: 2000, runCount: 2 });

		expect(reliability.summary.totalRuns).toBe(3);
		expect(reliability.summary.failedRuns).toBe(1);
		expect(reliability.summary.successRate).toBe(50);
	});

	it("marks stale jobs from repeatable schedule and latest execution", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [
				execution({
					id: "run-1",
					status: "completed",
					startedAt: "2026-05-10T11:00:00.000Z",
					completedAt: "2026-05-10T11:00:01.000Z",
					durationMs: 1000,
				}),
			],
			repeatableJobs: [repeatable({ name: "cron:export", pattern: "*/5 * * * *" })],
		});

		expect(reliability.summary.staleJobs).toBe(1);
		expect(reliability.jobs[0]).toMatchObject({ jobName: "cron:export", health: "stale" });
	});

	it("reports the latest completed execution completedAt when a newer run failed", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [
				execution({
					id: "run-1",
					status: "completed",
					startedAt: "2026-05-10T08:00:00.000Z",
					completedAt: "2026-05-10T08:00:03.000Z",
					durationMs: 3000,
				}),
				execution({
					id: "run-2",
					status: "failed",
					startedAt: "2026-05-10T09:00:00.000Z",
					completedAt: "2026-05-10T09:00:01.000Z",
					durationMs: 1000,
				}),
			],
			repeatableJobs: [repeatable({ name: "cron:export", pattern: "0 * * * *" })],
		});

		expect(reliability.jobs[0]).toMatchObject({
			lastRunAt: "2026-05-10T09:00:00.000Z",
			lastCompletedAt: "2026-05-10T08:00:03.000Z",
		});
	});

	it("excludes running durations from summary, daily, and job averages", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [
				execution({
					id: "run-1",
					status: "completed",
					startedAt: "2026-05-10T08:00:00.000Z",
					completedAt: "2026-05-10T08:00:01.000Z",
					durationMs: 1000,
				}),
				execution({
					id: "run-2",
					status: "failed",
					startedAt: "2026-05-10T09:00:00.000Z",
					completedAt: "2026-05-10T09:00:03.000Z",
					durationMs: 3000,
				}),
				execution({
					id: "run-3",
					status: "running",
					startedAt: "2026-05-10T10:00:00.000Z",
					durationMs: 10_000,
				}),
			],
			repeatableJobs: [repeatable({ name: "cron:export", pattern: "0 * * * *" })],
		});

		expect(reliability.summary.averageDurationMs).toBe(2000);
		expect(reliability.durationSeries).toEqual([
			{ date: "2026-05-10", averageDurationMs: 2000, runCount: 2 },
		]);
		expect(reliability.jobs[0]?.averageDurationMs).toBe(2000);
	});

	it("returns empty reliability data without throwing", () => {
		const reliability = buildReliabilityData({
			now,
			windowDays: 30,
			executions: [],
			repeatableJobs: [],
		});

		expect(reliability.summary).toMatchObject({
			totalRuns: 0,
			failedRuns: 0,
			staleJobs: 0,
			successRate: null,
			averageDurationMs: null,
		});
		expect(reliability.outcomeSeries).toEqual([]);
		expect(reliability.durationSeries).toEqual([]);
		expect(reliability.jobs).toEqual([]);
	});
});
