import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allocateAnalyticsWorkPeriodMinutes } from "@/lib/analytics/work-period-allocation";
import { resolveReportDateRange } from "@/lib/reports/report-date-range";

const SERVICES_ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("analytics service date boundaries", () => {
	it("allocates a Berlin cross-midnight period equally to summary and chart buckets", () => {
		const allocation = allocateAnalyticsWorkPeriodMinutes(
			[
				{
					employeeId: "employee-1",
					startTime: new Date("2026-05-01T21:30:00Z"),
					endTime: new Date("2026-05-01T22:30:00Z"),
				},
			],
			resolveReportDateRange("2026-05-01", "2026-05-02", "Europe/Berlin"),
		);

		expect(allocation.minutesByEmployee.get("employee-1")).toBe(60);
		expect([...allocation.minutesByDate.entries()]).toEqual([
			["2026-05-01", 30],
			["2026-05-02", 30],
		]);
	});
	it("uses adapter-provided instants as half-open overlap boundaries", () => {
		const source = readFileSync(`${SERVICES_ROOT}/analytics.service.ts`, "utf8");

		expect(source).toContain("new Date(dateRange.end.getTime() + 1)");
		expect(source).toContain("lt(workPeriod.startTime, rangeEndExclusive)");
		expect(source).toContain("gt(workPeriod.endTime, dateRange.start)");
		expect(source).toContain("reportRange.splitPeriod");
	});

	it("uses explicit adapter calendar metadata instead of UTC date slicing", () => {
		const source = readFileSync(`${SERVICES_ROOT}/analytics.service.ts`, "utf8");

		expect(source).toContain("getAnalyticsCalendarRange(dateRange)");
		expect(source).not.toContain("dateRange.start.toISOString().split");
		expect(source).not.toContain("dateRange.end.toISOString().split");
	});

	it("rejects calendar metadata that does not match the Date epochs", () => {
		const source = readFileSync(`${SERVICES_ROOT}/analytics.service.ts`, "utf8");

		expect(source).toContain("Analytics calendar metadata does not match its Date boundaries");
		expect(source).toContain("range.start.epochMilliseconds !== dateRange.start.getTime()");
	});

	it("filters vacation rows to the requested organization before aggregation", () => {
		const source = readFileSync(`${SERVICES_ROOT}/analytics.service.ts`, "utf8");

		expect(source).toContain(".filter((row) => row.employee.organizationId === organizationId)");
	});

	it("uses the same clipped pieces for summary, employees, and chart rows", () => {
		const source = readFileSync(`${SERVICES_ROOT}/analytics.service.ts`, "utf8");

		expect(source).toContain("minutesByEmployee");
		expect(source).toContain("minutesByEmployee.set(");
	});

	it("uses inclusive PlainDate durations and organization-scoped work-period queries", () => {
		const source = readFileSync(`${SERVICES_ROOT}/analytics.service.ts`, "utf8");

		expect(source).toContain("function inclusiveCalendarDays");
		expect(source).toContain("eq(workPeriod.organizationId, organizationId)");
	});
});
