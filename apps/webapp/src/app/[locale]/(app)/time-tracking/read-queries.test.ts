import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readActiveWorkPeriod,
	readComplianceDayCompletedMinutes,
	readTimeSummary,
	readWorkPeriods,
} from "./read-queries";

const fixture = vi.hoisted(() => ({
	active: vi.fn(),
	periods: vi.fn(),
	requests: vi.fn(),
	workflows: vi.fn(),
	summary: vi.fn(),
	complianceDay: vi.fn(),
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			workPeriod: { findFirst: fixture.active, findMany: fixture.periods },
			approvalRequest: { findMany: fixture.requests },
			approvalWorkflow: { findMany: fixture.workflows },
		},
		select: () => ({
			from: () => ({
				leftJoin: () => ({ where: fixture.summary }),
				where: fixture.complianceDay,
			}),
		}),
	},
}));

const scope = { employeeId: "employee-1", organizationId: "org-1" };
const start = new Date("2026-03-01T00:00:00Z");
const end = new Date("2026-03-31T23:59:59Z");

function assertScope(where: SQL) {
	const query = new PgDialect().sqlToQuery(where);
	expect(query.params).toContain(scope.employeeId);
	expect(query.params).toContain(scope.organizationId);
}

describe("organization scoped render readers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fixture.active.mockResolvedValue(null);
		fixture.periods.mockResolvedValue([]);
		fixture.requests.mockResolvedValue([]);
		fixture.workflows.mockResolvedValue([]);
		fixture.summary.mockResolvedValue([]);
		fixture.complianceDay.mockResolvedValue([]);
	});
	afterEach(() => vi.useRealTimers());

	it("scopes active, history, summary and compliance-day work period queries with both IDs", async () => {
		await readActiveWorkPeriod(scope);
		await readWorkPeriods(scope, start, end);
		await readTimeSummary(scope, "Europe/Berlin", "monday");
		await readComplianceDayCompletedMinutes(scope, "Europe/Berlin");
		assertScope(fixture.active.mock.calls[0][0].where);
		assertScope(fixture.periods.mock.calls[0][0].where);
		assertScope(fixture.summary.mock.calls[0][0]);
		assertScope(fixture.complianceDay.mock.calls[0][0]);
		for (const where of [
			fixture.periods.mock.calls[0][0].where,
			fixture.summary.mock.calls[0][0],
			fixture.complianceDay.mock.calls[0][0],
		]) {
			expect(new PgDialect().sqlToQuery(where).sql).toContain(
				'"deleted_at" is null',
			);
		}
	});

	it("preserves active mapping and absent clock-out", async () => {
		fixture.active.mockResolvedValue({
			id: "active",
			clockIn: { id: "in" },
			clockOut: null,
		});
		await expect(readActiveWorkPeriod(scope)).resolves.toEqual({
			id: "active",
			clockIn: { id: "in" },
			clockOut: undefined,
			approvalRequestId: null,
		});
	});

	it("returns newest first with ordinary request precedence and current-stage assignment targets", async () => {
		const periods = ["legacy", "workflow", "correction", "approved"].map(
			(id, index) => ({
				id,
				startTime: new Date(`2026-03-0${index + 1}T08:00:00Z`),
				approvalStatus: id === "approved" ? "approved" : "pending",
				clockIn: { id: `${id}-in` },
				clockOut: null,
			}),
		);
		fixture.periods.mockResolvedValue(periods);
		fixture.requests.mockResolvedValue([
			{
				id: "correction-request",
				entityId: "correction",
				metadata: { timeRequest: { kind: "time_correction" } },
			},
			{
				id: "ordinary-request",
				entityId: "legacy",
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					surchargeSnapshot: {
						version: 1,
						evaluatedAt: "2026-03-29T08:01:00Z",
						resolution: { kind: "none" },
					},
				},
			},
			{
				id: "duplicate-request",
				entityId: "legacy",
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					surchargeSnapshot: {
						version: 1,
						evaluatedAt: "2026-03-29T08:01:00Z",
						resolution: { kind: "none" },
					},
				},
			},
		]);
		fixture.workflows.mockResolvedValue([
			{
				sourceId: "legacy",
				currentStageOrder: 1,
				stages: [{ sequence: 1, assignments: [{ id: "ignored-assignment" }] }],
			},
			{
				sourceId: "workflow",
				currentStageOrder: 2,
				stages: [
					{ sequence: 1, assignments: [{ id: "old-assignment" }] },
					{ sequence: 2, assignments: [{ id: "current-assignment" }] },
				],
			},
		]);
		const result = await readWorkPeriods(scope, start, end);
		expect(
			result.map(({ id, approvalRequestId }) => ({ id, approvalRequestId })),
		).toEqual([
			{ id: "approved", approvalRequestId: null },
			{ id: "correction", approvalRequestId: null },
			{ id: "workflow", approvalRequestId: "current-assignment" },
			{ id: "legacy", approvalRequestId: "ordinary-request" },
		]);
		for (const read of [fixture.requests, fixture.workflows]) {
			expect(
				new PgDialect().sqlToQuery(read.mock.calls[0][0].where).params,
			).toContain(scope.organizationId);
		}
	});

	it.each(["sunday", "monday"] as const)(
		"preserves %s week totals across the Berlin DST boundary",
		async (weekStart) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-03-30T10:00:00Z"));
			fixture.summary.mockResolvedValue([
				{
					startTime: new Date("2026-03-29T00:30:00Z"),
					endTime: new Date("2026-03-29T02:30:00Z"),
					surchargeMinutes: 30,
				},
				{
					startTime: new Date("2026-03-29T22:30:00Z"),
					endTime: new Date("2026-03-29T23:30:00Z"),
					surchargeMinutes: 15,
				},
				{
					startTime: new Date("2026-03-01T08:00:00Z"),
					endTime: new Date("2026-03-01T08:20:00Z"),
					surchargeMinutes: null,
				},
				// Live work for 30 minutes.
				{
					startTime: new Date("2026-03-30T09:30:00Z"),
					endTime: null,
					surchargeMinutes: null,
				},
			]);
			const { dayTotals, ...totals } = await readTimeSummary(
				scope,
				"Europe/Berlin",
				weekStart,
			);
			expect(totals).toEqual({
				todayMinutes: 90,
				weekMinutes: weekStart === "sunday" ? 210 : 90,
				monthMinutes: 230,
				todaySurchargeMinutes: 15,
				weekSurchargeMinutes: weekStart === "sunday" ? 45 : 15,
				monthSurchargeMinutes: 45,
			});
			expect(dayTotals?.liveWork).toEqual([
				{ startedAt: new Date("2026-03-30T09:30:00Z") },
			]);
		},
	);

	it("keeps zero-summary defaults without optional surcharges", async () => {
		const { dayTotals: _, ...totals } = await readTimeSummary(
			scope,
			"UTC",
			"sunday",
		);
		expect(totals).toEqual({
			todayMinutes: 0,
			weekMinutes: 0,
			monthMinutes: 0,
		});
	});

	it("counts the compliance day's completed work whole and leaves out live work", async () => {
		fixture.complianceDay.mockResolvedValue([
			{ durationMinutes: 240 },
			{ durationMinutes: null },
		]);
		await expect(
			readComplianceDayCompletedMinutes(scope, "Europe/Berlin"),
		).resolves.toBe(240);
	});
});
