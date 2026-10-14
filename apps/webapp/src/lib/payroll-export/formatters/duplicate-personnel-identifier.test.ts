/**
 * #1198: the DATEV Lohn, Lexware and Sage files group lines by personnel
 * number. Two employees written under one number would be merged into one
 * line, so each formatter refuses the file instead, under every personnel
 * number type and for every kind of row.
 */

import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { PayrollIdentifierDuplicateError } from "../personnel-identifier";
import type {
	AbsenceData,
	ExpenseLineData,
	IPayrollExportFormatter,
	OvertimePayoutData,
	WorkPeriodData,
} from "../types";
import { DatevLohnFormatter } from "./datev-lohn-formatter";
import { LexwareLohnFormatter } from "./lexware-lohn-formatter";
import { SageLohnFormatter } from "./sage-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const ANNA = "employee-anna";
const BEN = "employee-ben";

function shift(employeeId: string, employeeNumber: string | null, extra = {}): WorkPeriodData {
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
		...extra,
	};
}

function vacation(employeeId: string, employeeNumber: string | null): AbsenceData {
	return {
		id: `absence-${employeeId}`,
		employeeId,
		employeeNumber,
		firstName: null,
		lastName: null,
		startDate: "2026-09-14",
		endDate: "2026-09-14",
		absenceCategoryId: "category-vacation",
		absenceCategoryName: "Vacation",
		absenceType: "vacation",
		status: "approved",
	};
}

function payout(employeeId: string, employeeNumber: string | null): OvertimePayoutData {
	return {
		id: `payout-${employeeId}`,
		employeeId,
		employeeNumber,
		firstName: null,
		lastName: null,
		day: "2026-09-20",
		minutes: 120,
	};
}

function expense(employeeId: string, employeeNumber: string | null): ExpenseLineData {
	return {
		employeeId,
		employeeNumber,
		firstName: null,
		lastName: null,
		wageTypeCode: "9001",
		amount: "12.00",
		currency: "EUR",
		date: "2026-09-30",
	};
}

const formats: Array<[string, IPayrollExportFormatter, Record<string, unknown>]> = [
	["DATEV Lohn", new DatevLohnFormatter(), { mandantennummer: "12345", beraternummer: "1234567" }],
	["Lexware", new LexwareLohnFormatter(), { includeStunden: true }],
	["Sage", new SageLohnFormatter(), { outputFormat: "sage_native" }],
];

function refusal(run: () => unknown): PayrollIdentifierDuplicateError {
	try {
		run();
	} catch (error) {
		if (error instanceof PayrollIdentifierDuplicateError) return error;
		throw error;
	}
	throw new Error("expected the export to be refused");
}

describe.each(formats)(
	"%s refuses employees sharing a personnel identifier",
	(_, formatter, base) => {
		const byNumber = { ...base, personnelNumberType: "employeeNumber" };

		it("refuses two employee numbers that differ only in case or spaces, naming both", () => {
			const error = refusal(() =>
				formatter.transform([shift(ANNA, "E-42"), shift(BEN, " e-42")], [], [], [], byNumber),
			);

			expect(error.clashes).toEqual([
				{
					employees: [
						{ employeeId: ANNA, identifier: "E-42" },
						{ employeeId: BEN, identifier: " e-42" },
					],
				},
			]);
		});

		it("refuses an employee number equal to the ID another employee falls back to", () => {
			const error = refusal(() =>
				formatter.transform(
					[shift(ANNA, null)],
					[vacation(BEN, ANNA.toUpperCase())],
					[],
					[],
					byNumber,
				),
			);

			expect(error.clashes[0]?.employees.map((holder) => holder.employeeId)).toEqual([ANNA, BEN]);
		});

		it("refuses a clash carried only by overtime payouts or expense lines", () => {
			expect(() =>
				formatter.transform([shift(ANNA, "E-42")], [], [expense(BEN, "E-42")], [], byNumber, []),
			).toThrow(PayrollIdentifierDuplicateError);
			expect(() =>
				formatter.transform([shift(ANNA, "E-42")], [], [], [], byNumber, [payout(BEN, "E-42")]),
			).toThrow(PayrollIdentifierDuplicateError);
		});

		it("refuses two employees with the same custom field identifier", () => {
			const byField = {
				...base,
				personnelNumberType: "customField",
				personnelNumberCustomFieldId: "field-1",
			};

			const error = refusal(() =>
				formatter.transform(
					[
						shift(ANNA, "E-1", { personnelIdentifier: "LG-7" }),
						shift(BEN, "E-2", { personnelIdentifier: "lg-7" }),
					],
					[],
					[],
					[],
					byField,
				),
			);

			expect(error.clashes[0]?.employees).toEqual([
				{ employeeId: ANNA, identifier: "LG-7" },
				{ employeeId: BEN, identifier: "lg-7" },
			]);
		});

		it("exports 0042 and 42 as two employees", () => {
			const result = formatter.transform(
				[shift(ANNA, "0042"), shift(BEN, "42")],
				[],
				[],
				[],
				byNumber,
			);

			expect(String(result.content)).toContain("0042");
			expect(result.metadata.employeeCount).toBe(2);
		});
	},
);
