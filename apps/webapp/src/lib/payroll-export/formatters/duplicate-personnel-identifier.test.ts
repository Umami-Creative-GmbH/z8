/**
 * #1198: the DATEV Lohn, Lexware and Sage files group lines by personnel
 * number, compared with leading zeros kept. The export service refuses two
 * employees under one number before a formatter runs (see
 * `duplicate-personnel-identifier.integration.test.ts`); the formatters write
 * numbers that differ only in leading zeros as two employees.
 */

import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type { IPayrollExportFormatter, WorkPeriodData } from "../types";
import { DatevLohnFormatter } from "./datev-lohn-formatter";
import { LexwareLohnFormatter } from "./lexware-lohn-formatter";
import { SageLohnFormatter } from "./sage-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

function shift(employeeId: string, employeeNumber: string | null): WorkPeriodData {
	return {
		id: `period-${employeeId}`,
		employeeId,
		employeeNumber,
		firstName: null,
		lastName: null,
		startTime: DateTime.fromISO("2026-09-10T08:00:00Z", { zone: "utc" }),
		endTime: DateTime.fromISO("2026-09-10T16:00:00Z", { zone: "utc" }),
		durationMinutes: 480,
		workCategoryId: null,
		workCategoryName: null,
		workCategoryFactor: null,
		projectId: null,
		projectName: null,
	};
}

const formats: Array<[string, IPayrollExportFormatter, Record<string, unknown>]> = [
	["DATEV Lohn", new DatevLohnFormatter(), { mandantennummer: "12345", beraternummer: "1234567" }],
	["Lexware", new LexwareLohnFormatter(), { includeStunden: true }],
	["Sage", new SageLohnFormatter(), { outputFormat: "sage_native" }],
];

describe.each(formats)("%s personnel numbers", (_, formatter, base) => {
	it("exports 0042 and 42 as two employees", () => {
		const result = formatter.transform(
			[shift("employee-anna", "0042"), shift("employee-ben", "42")],
			[],
			[],
			[],
			{ ...base, personnelNumberType: "employeeNumber" },
		);

		expect(String(result.content)).toContain("0042");
		expect(result.metadata.employeeCount).toBe(2);
	});
});
