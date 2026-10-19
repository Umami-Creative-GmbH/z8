import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type {
	AbsenceData,
	OvertimePayoutData,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";
import { DatevLohnFormatter } from "./datev-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const config = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "customField",
	includeZeroHours: false,
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
		datevWageTypeCode: "1900",
		datevWageTypeName: "Combined",
		lexwareWageTypeCode: null,
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

describe("DATEV supported output evidence", () => {
	it("retains all contributing kinds at the actual merged row's precision and identifiers", () => {
		const result = new DatevLohnFormatter().transform(
			[work()],
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
			'"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"',
			'"CUSTOM-7";"1900";8.03;"2026-09-15";"Combined"',
		]);
		expect(result.supportedOutputEvidence).toMatchObject({
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [
				{
					personnelNumber: "CUSTOM-7",
					wageTypeCode: "1900",
					date: "2026-09-15",
					quantity: "8.03",
					unit: "hours",
					note: "Combined",
					contributions: [
						{
							kind: "work",
							sourceId: "work-1",
							sourceRevision: null,
							employeeId: "employee-1",
							firstName: "Ada",
							lastName: "Lovelace",
							hours: 1 / 60,
							facts: {
								durationMinutes: 1,
								workCategoryId: "work-category",
								projectId: "project-1",
							},
						},
						{
							kind: "absence",
							sourceId: "absence-1",
							hours: 8,
							facts: {
								startDate: "2026-09-15",
								endDate: "2026-09-15",
								absenceCategoryId: "absence-category",
								status: "approved",
							},
						},
						{
							kind: "overtime_payout",
							sourceId: "payout-1",
							hours: 1 / 60,
							facts: { day: "2026-09-15", minutes: 1 },
						},
					],
				},
			],
		});
	});
	it("captures only emitted supported rows and preserves DATEV's existing zero suppression", () => {
		const periods = [
			work({ durationMinutes: 60 }),
			work({ id: "negative", durationMinutes: -60 }),
			work({ id: "zero", durationMinutes: 0 }),
			work({ id: "open", endTime: null }),
		];
		const formatter = new DatevLohnFormatter();
		const suppressed = formatter.transform(periods, [], [], [], config);
		expect(suppressed.supportedOutputEvidence?.rows).toEqual([]);
		expect(String(suppressed.content).split("\r\n")).toHaveLength(1);
		const included = formatter.transform(periods, [], [], [], {
			...config,
			includeZeroHours: true,
		});
		expect(String(included.content).split("\r\n")[1]).toBe(
			'"CUSTOM-7";"1000";0.00;"2026-09-15";"Work - Project"',
		);
		expect(included.supportedOutputEvidence?.rows).toMatchObject([
			{
				wageTypeCode: "1000",
				quantity: "0.00",
				contributions: [{ sourceId: "work-1" }, { sourceId: "negative" }],
			},
		]);
	});

	it("keeps expense-only files as valid empty supported output", () => {
		const result = new DatevLohnFormatter().transform(
			[],
			[],
			[
				{
					...identity,
					wageTypeCode: "8000",
					amount: "19.95",
					currency: "EUR",
					date: "2026-09-30",
				},
			],
			[],
			config,
		);
		expect(String(result.content).split("\r\n")[1]).toBe(
			'"CUSTOM-7";"8000";19.95;"2026-09-30";"Reisekostenerstattung in EUR"',
		);
		expect(result.supportedOutputEvidence).toMatchObject({
			excludedLineKinds: ["expense"],
			rows: [],
		});
	});

	it("retains each converted absence day, mapped payouts and source revisions without applying factors", () => {
		const result = new DatevLohnFormatter().transform(
			[],
			[
				{
					...absence,
					endDate: "2026-09-16",
					sourceRevision: "absence-revision",
				},
			],
			[],
			[
				mapping({
					absenceCategoryId: "absence-category",
					datevWageTypeCode: "1600",
				}),
				mapping({ specialCategory: "overtime", datevWageTypeCode: "1900" }),
			],
			config,
			[
				{
					...payout,
					minutes: 30,
					sourceRevision: "payout-revision",
					sourceReason: "Approved payout",
					sourceActorId: "operator-1",
				},
			],
		);
		expect(String(result.content).split("\r\n").slice(1)).toEqual([
			'"CUSTOM-7";"1600";8.00;"2026-09-15";"Combined"',
			'"CUSTOM-7";"1900";0.50;"2026-09-15";"Überstundenauszahlung"',
			'"CUSTOM-7";"1600";8.00;"2026-09-16";"Combined"',
		]);
		expect(result.supportedOutputEvidence?.rows).toMatchObject([
			{
				date: "2026-09-15",
				quantity: "8.00",
				contributions: [{ sourceRevision: "absence-revision", hours: 8 }],
			},
			{
				date: "2026-09-15",
				quantity: "0.50",
				contributions: [
					{
						sourceRevision: "payout-revision",
						reason: "Approved payout",
						sourceActorId: "operator-1",
						hours: 0.5,
					},
				],
			},
			{
				date: "2026-09-16",
				quantity: "8.00",
				contributions: [{ sourceRevision: "absence-revision", hours: 8 }],
			},
		]);
	});

	it("does not invent supported rows for unmapped absences or payouts", () => {
		const result = new DatevLohnFormatter().transform(
			[],
			[absence],
			[],
			[],
			config,
			[payout],
		);
		expect(result.supportedOutputEvidence?.rows).toEqual([]);
		expect(String(result.content).split("\r\n")).toHaveLength(1);
		expect(result.metadata.unmappedOvertimePayouts).toEqual([
			{
				id: "payout-1",
				employeeId: "employee-1",
				day: "2026-09-15",
				minutes: 1,
			},
		]);
	});
});
