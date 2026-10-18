import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type {
	AbsenceData,
	OvertimePayoutData,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";
import { LexwareLohnFormatter } from "./lexware-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const config = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "customField",
	includeZeroHours: false,
	includeStunden: true,
	includeStundensatz: true,
};
const identity = {
	employeeId: "employee-1",
	employeeNumber: "old-number",
	personnelIdentifier: "CUSTOM-7",
	firstName: "Ada",
	lastName: "Lovelace",
};
function mapping(overrides: Partial<WageTypeMapping>): WageTypeMapping {
	return {
		id: "mapping-1",
		workCategoryId: null,
		absenceCategoryId: null,
		specialCategory: null,
		wageTypeCode: "",
		wageTypeName: null,
		datevWageTypeCode: null,
		datevWageTypeName: "Combined",
		lexwareWageTypeCode: "190",
		lexwareWageTypeName: null,
		sageWageTypeCode: null,
		sageWageTypeName: null,
		successFactorsTimeTypeCode: null,
		successFactorsTimeTypeName: null,
		factor: "2.00",
		isActive: true,
		...overrides,
	};
}
function work(overrides: Partial<WorkPeriodData> = {}): WorkPeriodData {
	return {
		...identity,
		id: "work-1",
		startTime: DateTime.fromISO("2026-09-15T08:00:00Z"),
		endTime: DateTime.fromISO("2026-09-15T08:01:00Z"),
		durationMinutes: 1,
		workCategoryId: "work-category",
		workCategoryName: "Work",
		workCategoryFactor: "3.00",
		projectId: "project-1",
		projectName: "Project",
		...overrides,
	};
}
const absence: AbsenceData = {
	...identity,
	id: "absence-1",
	startDate: "2026-09-15",
	endDate: "2026-09-15",
	absenceCategoryId: "absence-category",
	absenceCategoryName: "Vacation",
	absenceType: "vacation",
	status: "approved",
};
const payout: OvertimePayoutData = {
	...identity,
	id: "payout-1",
	day: "2026-09-15",
	minutes: 1,
};

describe("Lexware supported output evidence", () => {
	it("retains the exact monthly mixed-kind row and optional rendered columns without changing the file", () => {
		const result = new LexwareLohnFormatter().transform(
			[
				work(),
				work({
					id: "late-work",
					startTime: DateTime.fromISO("2026-09-29T08:00:00Z"),
				}),
			],
			[absence],
			[],
			[
				mapping({ workCategoryId: "work-category" }),
				mapping({ absenceCategoryId: "absence-category" }),
				mapping({ specialCategory: "overtime" }),
			],
			config,
			[payout],
		);
		expect(String(result.content).split("\r\n")).toEqual([
			"Jahr;Monat;Personalnummer;Lohnartennummer;Wert;Stunden;Stundensatz",
			"2026;09;CUSTOM-7;190;8,05;8,05;",
		]);
		expect(result.supportedOutputEvidence).toMatchObject({
			version: 1,
			formatId: "lexware_lohn",
			excludedLineKinds: ["expense"],
			rows: [
				{
					personnelNumber: "CUSTOM-7",
					wageTypeCode: "190",
					date: "2026-09",
					quantity: "8.05",
					unit: "hours",
					note: "",
					renderedColumns: { Wert: "8,05", Stunden: "8,05", Stundensatz: "" },
					contributions: [
						{ kind: "work", sourceId: "work-1", hours: 1 / 60 },
						{ kind: "work", sourceId: "late-work", hours: 1 / 60 },
						{ kind: "absence", sourceId: "absence-1", hours: 8 },
						{ kind: "overtime_payout", sourceId: "payout-1", hours: 1 / 60 },
					],
				},
			],
		});
	});
	it("captures successful empty output, zero suppression and only configured numeric columns", () => {
		const formatter = new LexwareLohnFormatter();
		const rows = [
			work({ durationMinutes: 60 }),
			work({ id: "negative", durationMinutes: -60 }),
			work({ id: "zero", durationMinutes: 0 }),
			work({ id: "open", endTime: null }),
		];
		expect(
			formatter.transform(rows, [], [], [], config).supportedOutputEvidence
				?.rows,
		).toEqual([]);
		const result = formatter.transform(rows, [], [], [], {
			...config,
			includeZeroHours: true,
			includeStunden: false,
			includeStundensatz: false,
		});
		expect(result.supportedOutputEvidence?.rows).toMatchObject([
			{
				quantity: "0.00",
				renderedColumns: { Wert: "0,00" },
				contributions: [{ sourceId: "work-1" }, { sourceId: "negative" }],
			},
		]);
		expect(result.supportedOutputEvidence?.rows[0].renderedColumns).toEqual({
			Wert: "0,00",
		});
	});
});
