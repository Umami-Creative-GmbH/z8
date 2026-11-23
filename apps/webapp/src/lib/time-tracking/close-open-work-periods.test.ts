import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	formatCloseOpenWorkPeriods,
	parseCloseOpenWorkPeriodsCommand,
	runCloseOpenWorkPeriodsCli,
} from "../../../scripts/close-open-work-periods";
import {
	deriveOpenWorkPeriodCleanupOperationId,
	type OrganizationOpenWorkPeriodReport,
	resolveOpenPeriodCloseInstant,
} from "./close-open-work-periods";

const NOW = parseInstant("2026-11-21T18:00:00Z");

describe("resolveOpenPeriodCloseInstant", () => {
	it("closes at start + maxDurationMinutes when overdue without break or later work", () => {
		const resolved = resolveOpenPeriodCloseInstant({
			start: parseInstant("2026-11-18T08:00:00Z"),
			breakStartedAt: null,
			nextWorkStart: null,
			maxDurationMinutes: 720,
			now: NOW,
		});

		expect(resolved).toEqual({
			ok: true,
			closeAt: parseInstant("2026-11-18T20:00:00Z"),
			reason: "policy_cap",
		});
	});

	it("ends at breakStartedAt when a break in progress precedes the policy cap", () => {
		const resolved = resolveOpenPeriodCloseInstant({
			start: parseInstant("2026-11-18T08:00:00Z"),
			breakStartedAt: parseInstant("2026-11-18T12:15:00Z"),
			nextWorkStart: null,
			maxDurationMinutes: 720,
			now: NOW,
		});

		expect(resolved).toEqual({
			ok: true,
			closeAt: parseInstant("2026-11-18T12:15:00Z"),
			reason: "break_in_progress",
		});
	});

	it("caps at the next work period start to prevent creating overlapping work", () => {
		const resolved = resolveOpenPeriodCloseInstant({
			start: parseInstant("2026-11-18T08:00:00Z"),
			breakStartedAt: null,
			nextWorkStart: parseInstant("2026-11-18T13:00:00Z"),
			maxDurationMinutes: 720,
			now: NOW,
		});

		expect(resolved).toEqual({
			ok: true,
			closeAt: parseInstant("2026-11-18T13:00:00Z"),
			reason: "next_period_start",
		});
	});

	it("prefers an earlier next work period start over a later breakStartedAt", () => {
		const resolved = resolveOpenPeriodCloseInstant({
			start: parseInstant("2026-11-18T08:00:00Z"),
			breakStartedAt: parseInstant("2026-11-18T14:00:00Z"),
			nextWorkStart: parseInstant("2026-11-18T13:00:00Z"),
			maxDurationMinutes: 720,
			now: NOW,
		});

		expect(resolved).toEqual({
			ok: true,
			closeAt: parseInstant("2026-11-18T13:00:00Z"),
			reason: "next_period_start",
		});
	});

	it("never closes in the future when start + maxDurationMinutes is after now", () => {
		const resolved = resolveOpenPeriodCloseInstant({
			start: parseInstant("2026-11-21T14:00:00Z"),
			breakStartedAt: null,
			nextWorkStart: null,
			maxDurationMinutes: 720,
			now: NOW,
		});

		expect(resolved).toEqual({
			ok: true,
			closeAt: NOW,
			reason: "now_cap",
		});
	});

	it("refuses as invalid_interval when start is at or after now", () => {
		const resolved = resolveOpenPeriodCloseInstant({
			start: parseInstant("2026-11-21T19:00:00Z"),
			breakStartedAt: null,
			nextWorkStart: null,
			maxDurationMinutes: 720,
			now: NOW,
		});

		expect(resolved).toEqual({ ok: false, reason: "invalid_interval" });
	});
});

describe("deriveOpenWorkPeriodCleanupOperationId", () => {
	it("produces a stable canonical UUID v5 for identical inputs and changes on closeAt change", () => {
		const base = {
			organizationId: "org-1",
			employeeId: "emp-1",
			workPeriodId: "period-1",
			start: parseInstant("2026-11-18T08:00:00Z"),
			closeAt: parseInstant("2026-11-18T20:00:00Z"),
		};
		const id1 = deriveOpenWorkPeriodCleanupOperationId(base);
		const id2 = deriveOpenWorkPeriodCleanupOperationId(base);
		const id3 = deriveOpenWorkPeriodCleanupOperationId({
			...base,
			closeAt: parseInstant("2026-11-18T16:00:00Z"),
		});

		expect(id1).toBe(id2);
		expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(id3).not.toBe(id1);
	});
});

describe("close-open-work-periods CLI", () => {
	const env = {
		POSTGRES_HOST: "localhost",
		POSTGRES_PORT: "5432",
		POSTGRES_DB: "z8",
		POSTGRES_USER: "z8",
		POSTGRES_PASSWORD: "secret",
	};

	it("defaults to dry-run with a 12-hour cutoff", () => {
		const command = parseCloseOpenWorkPeriodsCommand([], NOW);

		expect(command).toEqual({
			kind: "close",
			apply: false,
			organizationId: null,
			startedBefore: parseInstant("2026-11-21T06:00:00Z"),
			maxDurationMinutes: null,
			json: false,
		});
	});

	it("parses --apply, --before, --organization-id, --max-duration-minutes, and --json", () => {
		const command = parseCloseOpenWorkPeriodsCommand(
			[
				"--apply",
				"--organization-id",
				"org-42",
				"--before",
				"2026-11-20T00:00:00Z",
				"--max-duration-minutes",
				"480",
				"--json",
			],
			NOW,
		);

		expect(command).toEqual({
			kind: "close",
			apply: true,
			organizationId: "org-42",
			startedBefore: parseInstant("2026-11-20T00:00:00Z"),
			maxDurationMinutes: 480,
			json: true,
		});
	});

	it("rejects combining --older-than-hours and --before", () => {
		expect(() =>
			parseCloseOpenWorkPeriodsCommand(
				["--older-than-hours", "24", "--before", "2026-11-20T00:00:00Z"],
				NOW,
			),
		).toThrow(/not both/);
	});

	it("formats dry-run and applied reports clearly", () => {
		const reports: OrganizationOpenWorkPeriodReport[] = [
			{
				organizationId: "org-1",
				scanned: 2,
				closed: [
					{
						workPeriodId: "wp-1",
						employeeId: "emp-1",
						startAt: "2026-11-18T08:00:00Z",
						closeAt: "2026-11-18T20:00:00Z",
						durationMinutes: 720,
						closeReason: "policy_cap",
						timezone: "Europe/Berlin",
						operationId: "op-1",
					},
				],
				skipped: [
					{
						workPeriodId: "wp-2",
						employeeId: "emp-2",
						startAt: "2026-10-01T08:00:00Z",
						reason: "month_closed (2026-10)",
					},
				],
				failed: [],
			},
		];

		const dryRunLines = formatCloseOpenWorkPeriods(reports, false).join("\n");
		expect(dryRunLines).toContain("dry run");
		expect(dryRunLines).toContain("to close wp-1");
		expect(dryRunLines).toContain("skipped wp-2");
		expect(dryRunLines).toContain("Nothing was changed.");

		const appliedLines = formatCloseOpenWorkPeriods(reports, true).join("\n");
		expect(appliedLines).toContain("applied");
		expect(appliedLines).toContain("closed wp-1");
		expect(appliedLines).not.toContain("Nothing was changed.");
	});

	it("runs end-to-end through CLI dependencies, closes pool, and fails when any period fails", async () => {
		const poolEnd = vi.fn(async () => undefined);
		const logged: string[] = [];
		const closeOpen = vi.fn(async () => [
			{
				organizationId: "org-1",
				scanned: 1,
				closed: [],
				skipped: [],
				failed: [
					{
						workPeriodId: "wp-err",
						employeeId: "emp-1",
						startAt: "2026-11-18T08:00:00Z",
						error: "boom",
					},
				],
			},
		]);

		await expect(
			runCloseOpenWorkPeriodsCli(["--apply", "--older-than-hours", "0"], env, {
				clock: { nowInstant: () => NOW },
				loadDatabase: async () => ({ pool: { end: poolEnd } }),
				closeOpen,
				output: { log: (line) => logged.push(line) },
			}),
		).rejects.toThrow("1 open work period was not closed");

		expect(closeOpen).toHaveBeenCalledWith(
			expect.objectContaining({
				apply: true,
				startedBefore: NOW,
			}),
		);
		expect(poolEnd).toHaveBeenCalledOnce();
		expect(logged.join("\n")).toContain("failed wp-err");
	});
});
