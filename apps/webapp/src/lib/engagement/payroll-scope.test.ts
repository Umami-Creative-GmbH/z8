import { describe, expect, it } from "vitest";
import type { EmploymentPeriodSnapshot } from "@/lib/contracts/resolve-contract";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { EngagementKind } from "./engagement-kind";
import type { EngagementStints } from "./employee-time";
import { employeeTime } from "./engagement-stints";
import { payrollScope } from "./payroll-scope";

/** Contractor until 15 July 2026 12:00 Berlin (10:00 UTC), employee from then on. */
const CONVERTED_AT = "2026-07-15T10:00:00Z";

function period(
	employeeId: string,
	engagementKind: EngagementKind,
	startedAt: string,
	endedAt: string | null,
): EmploymentPeriodSnapshot {
	return {
		id: `${employeeId}-${engagementKind}-${startedAt}`,
		employeeId,
		status: endedAt ? "closed" : "open",
		startedAt: parseInstant(startedAt),
		startProvenance: "recorded",
		endedAt: endedAt ? parseInstant(endedAt) : null,
		createdAt: parseInstant("2026-01-01T00:00:00Z"),
		engagementKind,
	};
}

const stints = new Map<string, EngagementStints>([
	["worker", { periods: [], employeeEngagementKind: "employee" }],
	[
		"contractor",
		{
			periods: [period("contractor", "contractor", "2026-01-01T00:00:00Z", null)],
			employeeEngagementKind: "contractor",
		},
	],
	[
		"converted",
		{
			periods: [
				period("converted", "contractor", "2026-01-01T00:00:00Z", CONVERTED_AT),
				period("converted", "employee", CONVERTED_AT, null),
			],
			employeeEngagementKind: "employee",
		},
	],
]);
const july = { startDate: "2026-07-01", endDate: "2026-07-31" };
const scope = payrollScope(
	employeeTime(stints, new Map(), "Europe/Berlin"),
	["worker", "contractor", "converted", "worker"],
	july,
);

function record(startAt: string, endAt: string | null, durationMinutes: number | null) {
	return {
		id: "record",
		startAt: parseInstant(startAt),
		endAt: endAt ? parseInstant(endAt) : null,
		durationMinutes,
	};
}

function shown(clipped: ReturnType<typeof record> | null) {
	return clipped
		? [clipped.startAt.toString(), clipped.endAt?.toString() ?? null, clipped.durationMinutes]
		: null;
}

describe("payroll scope (#1997)", () => {
	it("covers the people with employee time in the period, once each", () => {
		expect(scope.employeeIds).toEqual(["worker", "converted"]);
		expect(scope.includes("contractor")).toBe(false);
		expect(
			payrollScope(scope.employeeTime, ["converted"], {
				startDate: "2026-07-01",
				endDate: "2026-07-14",
			}).employeeIds,
		).toEqual([]);
	});

	it("carries payroll on days with employee time only, the conversion day included", () => {
		expect(scope.isPayrollDay("converted", "2026-07-14")).toBe(false);
		expect(scope.isPayrollDay("converted", "2026-07-15")).toBe(true);
		expect(scope.isPayrollDay("converted", "2026-07-16")).toBe(true);
		expect(scope.isPayrollDay("contractor", "2026-07-16")).toBe(false);
		expect(scope.isPayrollDay("worker", "2026-07-14")).toBe(true);
	});

	it("shows employee records whole, contractor records not at all and records across the conversion from it", () => {
		const employeeWork = record("2026-07-20T08:00:00Z", "2026-07-20T11:00:00Z", 180);
		expect(scope.clipRecord("converted", employeeWork)).toBe(employeeWork);
		expect(
			shown(
				scope.clipRecord("converted", record("2026-07-10T08:00:00Z", "2026-07-10T12:00:00Z", 240)),
			),
		).toBeNull();
		expect(
			shown(
				scope.clipRecord("converted", record("2026-07-15T08:00:00Z", "2026-07-15T12:00:00Z", 240)),
			),
		).toEqual([CONVERTED_AT, "2026-07-15T12:00:00Z", 120]);
		expect(shown(scope.clipRecord("contractor", employeeWork))).toBeNull();
	});

	it("keeps a running record in the stint it started in", () => {
		expect(
			shown(scope.clipRecord("converted", record("2026-07-15T09:00:00Z", null, null))),
		).toBeNull();
		expect(
			shown(scope.clipRecord("converted", record("2026-07-15T11:00:00Z", null, null))),
		).toEqual(["2026-07-15T11:00:00Z", null, null]);
	});

	it("blocks payroll only with departure clock repairs of timers stopped in employee time", () => {
		const repairs = [
			{ employeeId: "converted", affectedEndAt: new Date("2026-07-10T12:00:00Z") },
			{ employeeId: "converted", affectedEndAt: new Date(CONVERTED_AT) },
			{ employeeId: "converted", affectedEndAt: new Date("2026-07-20T12:00:00Z") },
			{ employeeId: "contractor", affectedEndAt: null },
			{ employeeId: "worker", affectedEndAt: null },
		];

		expect(scope.blockingClockRepairs(repairs)).toEqual([repairs[2], repairs[3], repairs[4]]);
	});
});
