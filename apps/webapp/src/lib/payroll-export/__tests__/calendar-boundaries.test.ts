import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	buildEmployeePayrollRange,
	buildPayrollQueryEnvelope,
	parsePayrollLogicalDate,
	serializePayrollLogicalDate,
} from "../calendar-boundaries";

describe("payroll export calendar boundaries", () => {
	it("converts employee-local payroll dates to UTC instants", () => {
		expect(buildEmployeePayrollRange("2026-05-01", "2026-05-31", "America/New_York")).toEqual({
			start: DateTime.fromISO("2026-05-01T04:00:00.000Z", { zone: "utc" }),
			end: DateTime.fromISO("2026-06-01T03:59:59.999Z", { zone: "utc" }),
		});
	});

	it("builds a safe query envelope across all UTC offsets", () => {
		expect(buildPayrollQueryEnvelope("2026-05-01", "2026-05-31")).toEqual({
			start: DateTime.fromISO("2026-04-30T10:00:00.000Z", { zone: "utc" }),
			end: DateTime.fromISO("2026-06-01T13:59:59.999Z", { zone: "utc" }),
		});
	});

	it("preserves logical dates when payroll filters cross server timezones", () => {
		const zonedDate = DateTime.fromISO("2026-05-01T00:00:00+14:00", { setZone: true });
		const serialized = serializePayrollLogicalDate(zonedDate);

		expect(serialized).toBe("2026-05-01");
		expect(parsePayrollLogicalDate(serialized).toISODate()).toBe("2026-05-01");
	});
});
