/**
 * #852: every payroll file format carries the expense money lines of a payroll
 * run, as euro amounts distinct from hours, and nothing changes without them.
 */

import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { SuccessFactorsFormatter } from "../exporters/successfactors/successfactors-formatter";
import type { ExpenseLineData, WorkPeriodData } from "../types";
import { DatevLohnFormatter } from "./datev-lohn-formatter";
import { LexwareLohnFormatter } from "./lexware-lohn-formatter";
import { SageLohnFormatter } from "./sage-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const shift: WorkPeriodData = {
	id: "period-1",
	employeeId: "employee-1",
	employeeNumber: "P-1",
	firstName: "Ada",
	lastName: "Lovelace",
	startTime: DateTime.fromISO("2026-09-10T08:00:00Z", { zone: "utc" }),
	endTime: DateTime.fromISO("2026-09-10T16:00:00Z", { zone: "utc" }),
	durationMinutes: 480,
	workCategoryId: null,
	workCategoryName: null,
	workCategoryFactor: null,
	projectId: null,
	projectName: null,
};

function line(overrides: Partial<ExpenseLineData> = {}): ExpenseLineData {
	return {
		employeeId: "employee-1",
		employeeNumber: "P-1",
		firstName: "Ada",
		lastName: "Lovelace",
		wageTypeCode: "9001",
		amount: "123.40",
		currency: "EUR",
		date: "2026-09-30",
		...overrides,
	};
}

const colleague = line({
	employeeId: "employee-2",
	employeeNumber: "P-2",
	wageTypeCode: "9002",
	amount: "8.05",
});

function rows(content: string | Buffer): string[] {
	return String(content).replace(/^﻿/, "").split("\r\n");
}

const DATEV = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};

describe("DATEV Lohn expense lines", () => {
	it("writes one euro line per employee and wage type after the hours", () => {
		const result = new DatevLohnFormatter().transform([shift], [], [line(), colleague], [], DATEV);

		expect(rows(result.content)).toEqual([
			'"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"',
			'"P-1";"1000";8.00;"2026-09-10";""',
			'"P-1";"9001";123.40;"2026-09-30";"Reisekostenerstattung in EUR"',
			'"P-2";"9002";8.05;"2026-09-30";"Reisekostenerstattung in EUR"',
		]);
		expect(result.metadata.employeeCount).toBe(2);
	});

	it("is unchanged without expense lines", () => {
		const result = new DatevLohnFormatter().transform([shift], [], [], [], DATEV);

		expect(rows(result.content)).toEqual([
			'"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"',
			'"P-1";"1000";8.00;"2026-09-10";""',
		]);
	});

	it("falls back to the employee id like the hours do", () => {
		const result = new DatevLohnFormatter().transform(
			[],
			[],
			[line({ employeeNumber: null })],
			[],
			DATEV,
		);

		expect(rows(result.content)[1]).toBe(
			'"employee-1";"9001";123.40;"2026-09-30";"Reisekostenerstattung in EUR"',
		);
	});
});

describe("Lexware expense lines", () => {
	const config = {
		personnelNumberType: "employeeNumber",
		includeZeroHours: false,
		includeStunden: true,
		includeStundensatz: false,
	};

	it("writes the euro value with comma decimals and no hours", () => {
		const result = new LexwareLohnFormatter().transform(
			[shift],
			[],
			[line(), colleague],
			[],
			config,
		);

		expect(rows(result.content)).toEqual([
			"Jahr;Monat;Personalnummer;Lohnartennummer;Wert;Stunden",
			"2026;09;P-1;100;8,00;8,00",
			"2026;09;P-1;9001;123,40;",
			"2026;09;P-2;9002;8,05;",
		]);
	});
});

describe("Sage Lohn expense lines", () => {
	it("follows the output format's decimal separator", () => {
		const native = new SageLohnFormatter().transform([], [], [line()], [], {
			personnelNumberType: "employeeNumber",
			outputFormat: "sage_native",
		});
		const datevCompatible = new SageLohnFormatter().transform([], [], [line()], [], {
			personnelNumberType: "employeeNumber",
			outputFormat: "datev_compatible",
		});

		expect(rows(native.content)[1]).toBe(
			'"P-1";"9001";"123,40";"2026-09-30";"Reisekostenerstattung in EUR"',
		);
		expect(rows(datevCompatible.content)[1]).toBe(
			'"P-1";"9001";"123.40";"2026-09-30";"Reisekostenerstattung in EUR"',
		);
	});
});

describe("SuccessFactors CSV expense lines", () => {
	const config = { employeeMatchStrategy: "userId", includeZeroHours: false };

	it("adds amount and currency columns and leaves the hours empty", () => {
		const result = new SuccessFactorsFormatter().transform([shift], [], [line()], [], config);

		expect(rows(result.content)).toEqual([
			'"User ID";"Date";"Time Type";"Hours";"Comment";"Amount";"Currency"',
			'"P-1";"2026-09-10";"REGULAR";"8.00";"";"";""',
			'"P-1";"2026-09-30";"9001";"";"Expense reimbursement";"123.40";"EUR"',
		]);
	});

	it("keeps the hours-only header without expense lines", () => {
		const result = new SuccessFactorsFormatter().transform([shift], [], [], [], config);

		expect(rows(result.content)[0]).toBe('"User ID";"Date";"Time Type";"Hours";"Comment"');
	});
});
