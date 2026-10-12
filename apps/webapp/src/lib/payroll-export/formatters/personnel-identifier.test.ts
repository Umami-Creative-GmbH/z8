/**
 * #821: with an employee custom field as personnel identifier, every payroll
 * file writes the value frozen for the run where it writes the personnel
 * number today, for hours, absences and expense lines alike, and never falls
 * back to the employee number or ID.
 */

import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { SuccessFactorsFormatter } from "../exporters/successfactors/successfactors-formatter";
import { PayrollIdentifierMissingError } from "../personnel-identifier";
import type { AbsenceData, ExpenseLineData, WageTypeMapping, WorkPeriodData } from "../types";
import { DatevLohnFormatter } from "./datev-lohn-formatter";
import { LexwareLohnFormatter } from "./lexware-lohn-formatter";
import { SageLohnFormatter } from "./sage-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const FIELD_ID = "5d7f0a9e-1c44-4b7e-9a51-2f0c6f3d9b10";

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
	personnelIdentifier: "LG-0042",
};

const vacation: AbsenceData = {
	id: "absence-1",
	employeeId: "employee-1",
	employeeNumber: "P-1",
	firstName: "Ada",
	lastName: "Lovelace",
	startDate: "2026-09-14",
	endDate: "2026-09-14",
	absenceCategoryId: "category-vacation",
	absenceCategoryName: "Vacation",
	absenceType: "vacation",
	status: "approved",
	personnelIdentifier: "LG-0042",
};

const expense: ExpenseLineData = {
	employeeId: "employee-1",
	employeeNumber: "P-1",
	firstName: "Ada",
	lastName: "Lovelace",
	wageTypeCode: "9001",
	amount: "123.40",
	currency: "EUR",
	date: "2026-09-30",
	personnelIdentifier: "LG-0042",
};

const vacationMapping: WageTypeMapping = {
	id: "mapping-1",
	workCategoryId: null,
	absenceCategoryId: "category-vacation",
	specialCategory: null,
	wageTypeCode: "",
	wageTypeName: null,
	datevWageTypeCode: "1600",
	datevWageTypeName: "Urlaub",
	lexwareWageTypeCode: "160",
	lexwareWageTypeName: null,
	sageWageTypeCode: "1600",
	sageWageTypeName: null,
	successFactorsTimeTypeCode: "VAC",
	successFactorsTimeTypeName: null,
	factor: "1.00",
	isActive: true,
};

function rows(content: string | Buffer): string[] {
	return String(content).replace(/^﻿/, "").split("\r\n");
}

const byField = { personnelNumberType: "customField", personnelNumberCustomFieldId: FIELD_ID };

describe("DATEV Lohn with a custom field identifier", () => {
	const config = { mandantennummer: "12345", beraternummer: "1234567", ...byField };

	it("writes the frozen value as Personalnummer for hours, absences and expense lines", () => {
		const result = new DatevLohnFormatter().transform(
			[shift],
			[vacation],
			[expense],
			[vacationMapping],
			config,
		);

		expect(rows(result.content)).toEqual([
			'"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"',
			'"LG-0042";"1000";8.00;"2026-09-10";""',
			'"LG-0042";"1600";8.00;"2026-09-14";"Urlaub"',
			'"LG-0042";"9001";123.40;"2026-09-30";"Reisekostenerstattung in EUR"',
		]);
	});

	it("refuses a row without a value instead of writing the employee number", () => {
		expect(() =>
			new DatevLohnFormatter().transform(
				[{ ...shift, personnelIdentifier: null }],
				[],
				[],
				[],
				config,
			),
		).toThrow(PayrollIdentifierMissingError);
	});

	it("accepts the custom field option only with a field", () => {
		const formatter = new DatevLohnFormatter();
		expect(formatter.validateConfig(config)).toEqual({ valid: true });
		expect(
			formatter.validateConfig({ ...config, personnelNumberCustomFieldId: undefined }).valid,
		).toBe(false);
	});
});

describe("Lexware with a custom field identifier", () => {
	it("writes the frozen value as Personalnummer", () => {
		const result = new LexwareLohnFormatter().transform(
			[shift],
			[vacation],
			[expense],
			[vacationMapping],
			{ ...byField, includeZeroHours: false, includeStunden: true, includeStundensatz: false },
		);

		const personnelNumbers = rows(result.content)
			.slice(1)
			.map((row) => row.split(";")[2]);
		expect(personnelNumbers).toEqual(["LG-0042", "LG-0042", "LG-0042"]);
	});
});

describe("Sage Lohn with a custom field identifier", () => {
	it("writes the frozen value as Personalnummer", () => {
		const result = new SageLohnFormatter().transform(
			[shift],
			[vacation],
			[expense],
			[vacationMapping],
			{ ...byField, includeZeroHours: false, outputFormat: "sage_native" },
		);

		const personnelNumbers = rows(result.content)
			.slice(1)
			.map((row) => row.split(";")[0]);
		expect(personnelNumbers).toEqual(['"LG-0042"', '"LG-0042"', '"LG-0042"']);
	});
});

describe("SuccessFactors CSV with a custom field match key", () => {
	const config = {
		employeeMatchStrategy: "customField",
		employeeMatchCustomFieldId: FIELD_ID,
		includeZeroHours: false,
	};

	it("writes the frozen value as User ID", () => {
		const result = new SuccessFactorsFormatter().transform(
			[shift],
			[vacation],
			[expense],
			[vacationMapping],
			config,
		);

		const userIds = rows(result.content)
			.slice(1)
			.map((row) => row.split(";")[0]);
		expect(userIds).toEqual(['"LG-0042"', '"LG-0042"', '"LG-0042"']);
	});

	it("refuses a row without a value instead of writing the employee number", () => {
		expect(() =>
			new SuccessFactorsFormatter().transform(
				[{ ...shift, personnelIdentifier: undefined }],
				[],
				[],
				[],
				config,
			),
		).toThrow(PayrollIdentifierMissingError);
	});
});
