import { describe, expect, it } from "vitest";
import {
	formatEmployeeDetailDateInputValue,
	parseEmployeeDetailDateInputValue,
} from "@/app/[locale]/(app)/settings/employees/[employeeId]/page-utils";
import {
	formatHolidayDatePickerValue,
	parseHolidayDatePickerValue,
} from "@/components/settings/holiday/holiday-dialog-utils";
import {
	formatDate as formatSurchargeDate,
	formatTimestamp as formatSurchargeTimestamp,
	parseFilterDate,
} from "@/components/settings/surcharge-reports/helpers";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatDate, isCurrentConfirmed, isFutureConfirmed } from "./utils";

describe("settings temporal utilities (de/en locale, UTC dates, and DST boundaries)", () => {
	it("formats employment history dates in German (de) and English (en) without shifting UTC midnight", () => {
		const date = new Date("2026-03-01T00:00:00.000Z");

		const en = formatDate(date, "en");
		const de = formatDate(date, "de");

		expect(en).toContain("Mar");
		expect(en).toContain("1");
		expect(en).toContain("2026");
		expect(de).toContain("März");
		expect(de).toContain("2026");
		expect(de).not.toBe(en);
	});

	it("evaluates current and future confirmed employment history entries with Temporal instants", () => {
		const now = parseInstant("2026-03-29T01:30:00.000Z");
		const current = {
			id: "h-1",
			validFrom: new Date("2026-01-01T00:00:00.000Z"),
			validUntil: new Date("2026-06-01T00:00:00.000Z"),
			status: "active",
			contractType: "fixed" as const,
			weeklyContractMinutes: 2400,
			probationStartsOn: null,
			probationEndsOn: null,
			workModel: "hybrid" as const,
			workPolicyId: null,
			hourlyRate: null,
			currency: "EUR",
			changeReason: null,
			reviewState: "confirmed" as const,
		};
		const future = {
			...current,
			id: "h-2",
			validFrom: new Date("2026-06-01T00:00:00.000Z"),
			validUntil: null,
		};

		expect(isCurrentConfirmed(current, now)).toBe(true);
		expect(isFutureConfirmed(current, now)).toBe(false);
		expect(isCurrentConfirmed(future, now)).toBe(false);
		expect(isFutureConfirmed(future, now)).toBe(true);
	});

	it("round-trips UTC calendar dates in holiday and employee detail date pickers", () => {
		const holidayDate = parseHolidayDatePickerValue("2026-03-29");
		expect(holidayDate?.toISOString()).toBe("2026-03-29T00:00:00.000Z");
		expect(formatHolidayDatePickerValue(holidayDate)).toBe("2026-03-29");

		const employeeDate = parseEmployeeDetailDateInputValue("2026-10-25");
		expect(employeeDate?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
		expect(formatEmployeeDetailDateInputValue(employeeDate)).toBe("2026-10-25");
		expect(formatEmployeeDetailDateInputValue("invalid")).toBe("");
		expect(parseEmployeeDetailDateInputValue("invalid")).toBeNull();
	});

	it("formats surcharge report dates and timestamps in German (de) and English (en)", () => {
		const instant = new Date("2026-03-29T13:45:00.000Z");
		const enDate = formatSurchargeDate(instant, "en");
		const deDate = formatSurchargeDate(instant, "de");
		expect(enDate).toContain("Mar");
		expect(deDate).toContain("März");

		const enTs = formatSurchargeTimestamp("2026-03-29T13:45:00.000Z", "en");
		const deTs = formatSurchargeTimestamp("2026-03-29T13:45:00.000Z", "de");
		expect(enTs).toContain("Mar");
		expect(deTs).toContain("März");
		expect(formatSurchargeTimestamp("not-an-iso-timestamp", "en")).toBe("-");

		const start = parseFilterDate("2026-03-29", "start");
		const end = parseFilterDate("2026-03-29", "end");
		expect(start).not.toBeNull();
		expect(end).not.toBeNull();
		expect(end!.epochMilliseconds).toBeGreaterThan(start!.epochMilliseconds);
		expect(parseFilterDate("not-a-date", "start")).toBeNull();
	});
});
