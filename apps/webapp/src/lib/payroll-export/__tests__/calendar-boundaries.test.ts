import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	buildEmployeePayrollRange,
	buildPayrollQueryEnvelope,
	clipPayrollInterval,
	parsePayrollLogicalDate,
	serializePayrollLogicalDate,
} from "../calendar-boundaries";

describe("payroll export calendar boundaries", () => {
	it("converts employee-local payroll dates to UTC instants", () => {
		const range = buildEmployeePayrollRange("2026-05-01", "2026-05-31", "America/New_York");
		expect(range.start.toString({ fractionalSecondDigits: 3 })).toBe("2026-05-01T04:00:00.000Z");
		expect(range.end.toString({ fractionalSecondDigits: 3 })).toBe("2026-06-01T03:59:59.999Z");
	});

	it("handles DST spring-forward and fall-back month boundaries in Europe/Berlin", () => {
		// March 2026 transitions from CET (+01:00) to CEST (+02:00) on 2026-03-29
		const march = buildEmployeePayrollRange("2026-03-01", "2026-03-31", "Europe/Berlin");
		expect(march.start.toString({ fractionalSecondDigits: 3 })).toBe("2026-02-28T23:00:00.000Z");
		expect(march.end.toString({ fractionalSecondDigits: 3 })).toBe("2026-03-31T21:59:59.999Z");

		// October 2026 transitions from CEST (+02:00) to CET (+01:00) on 2026-10-25
		const october = buildEmployeePayrollRange("2026-10-01", "2026-10-31", "Europe/Berlin");
		expect(october.start.toString({ fractionalSecondDigits: 3 })).toBe("2026-09-30T22:00:00.000Z");
		expect(october.end.toString({ fractionalSecondDigits: 3 })).toBe("2026-10-31T22:59:59.999Z");
	});

	it("clips intervals cleanly across a DST spring-forward night", () => {
		const range = buildEmployeePayrollRange("2026-03-29", "2026-03-29", "Europe/Berlin");
		// 2026-03-29 in Europe/Berlin is 23 hours long: 2026-03-28T23:00Z .. 2026-03-29T21:59:59.999Z
		const clipped = clipPayrollInterval(
			parseInstant("2026-03-28T22:00:00.000Z"),
			parseInstant("2026-03-29T02:00:00.000Z"),
			range,
		);
		expect(clipped?.start.toString({ fractionalSecondDigits: 3 })).toBe("2026-03-28T23:00:00.000Z");
		expect(clipped?.end.toString({ fractionalSecondDigits: 3 })).toBe("2026-03-29T02:00:00.000Z");
		expect(clipped?.durationMinutes).toBe(180);
	});

	it("builds a safe query envelope across all UTC offsets", () => {
		const envelope = buildPayrollQueryEnvelope("2026-05-01", "2026-05-31");
		expect(envelope.start.toString({ fractionalSecondDigits: 3 })).toBe("2026-04-30T10:00:00.000Z");
		expect(envelope.end.toString({ fractionalSecondDigits: 3 })).toBe("2026-06-01T13:59:59.999Z");
	});

	it("preserves logical dates when payroll filters cross server timezones", () => {
		const zonedDate = parsePayrollLogicalDate("2026-05-01T00:00:00+14:00");
		const serialized = serializePayrollLogicalDate(zonedDate);

		expect(serialized).toBe("2026-05-01");
		expect(parsePayrollLogicalDate(serialized).equals(parsePlainDate("2026-05-01"))).toBe(true);
	});

	it("parses legacy UTC Z-suffixed ISO strings from stored export jobs", () => {
		expect(
			parsePayrollLogicalDate("2026-05-01T00:00:00.000Z").equals(parsePlainDate("2026-05-01")),
		).toBe(true);
		expect(
			parsePayrollLogicalDate("2026-05-31T23:59:59.999Z").equals(parsePlainDate("2026-05-31")),
		).toBe(true);
	});
});
