/**
 * #1001: the DATEV, Lexware and Sage payroll files carry overtime payouts as
 * hours under the wage type mapped to the "overtime" special category, and
 * report the payouts they cannot carry for want of that mapping.
 */

import { describe, expect, it, vi } from "vitest";
import type { OvertimePayoutData, WageTypeMapping } from "../types";
import { DatevLohnFormatter } from "./datev-lohn-formatter";
import { LexwareLohnFormatter } from "./lexware-lohn-formatter";
import { SageLohnFormatter } from "./sage-lohn-formatter";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

function payout(overrides: Partial<OvertimePayoutData> = {}): OvertimePayoutData {
	return {
		id: "payout-1",
		employeeId: "employee-1",
		employeeNumber: "P-1",
		firstName: "Ada",
		lastName: "Lovelace",
		day: "2026-09-15",
		minutes: 300,
		...overrides,
	};
}

function overtimeMapping(codes: Partial<WageTypeMapping> = {}): WageTypeMapping {
	return {
		id: "mapping-overtime",
		workCategoryId: null,
		absenceCategoryId: null,
		specialCategory: "overtime",
		wageTypeCode: "",
		wageTypeName: null,
		datevWageTypeCode: null,
		datevWageTypeName: null,
		lexwareWageTypeCode: null,
		lexwareWageTypeName: null,
		sageWageTypeCode: null,
		sageWageTypeName: null,
		successFactorsTimeTypeCode: null,
		successFactorsTimeTypeName: null,
		factor: "1.00",
		isActive: true,
		...codes,
	};
}

function rows(content: string | Buffer): string[] {
	return String(content).split("\r\n");
}

const DATEV = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};

describe("DATEV Lohn overtime payouts", () => {
	it("writes a 5h payout as 5 hours under the wage type mapped to overtime", () => {
		const result = new DatevLohnFormatter().transform(
			[],
			[],
			[],
			[overtimeMapping({ datevWageTypeCode: "1900" })],
			DATEV,
			[payout()],
		);

		expect(rows(result.content)).toEqual([
			'"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"',
			'"P-1";"1900";5.00;"2026-09-15";"Überstundenauszahlung"',
		]);
		expect(result.metadata.unmappedOvertimePayouts).toEqual([]);
		expect(result.metadata.employeeCount).toBe(1);
	});

	it("emits no line without a DATEV code for overtime and reports the payouts as unmapped", () => {
		const result = new DatevLohnFormatter().transform(
			[],
			[],
			[],
			// Mapped for Lexware only: DATEV never borrows another format's code.
			[overtimeMapping({ lexwareWageTypeCode: "LX-OT", wageTypeCode: "LX-OT" })],
			DATEV,
			[
				payout(),
				payout({ id: "payout-2", employeeId: "employee-2", day: "2026-09-20", minutes: 90 }),
			],
		);

		expect(rows(result.content)).toEqual([
			'"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"',
		]);
		expect(result.metadata.unmappedOvertimePayouts).toEqual([
			{ id: "payout-1", employeeId: "employee-1", day: "2026-09-15", minutes: 300 },
			{ id: "payout-2", employeeId: "employee-2", day: "2026-09-20", minutes: 90 },
		]);
		expect(result.metadata.employeeCount).toBe(0);
	});
});

describe("Lexware overtime payouts", () => {
	const config = {
		personnelNumberType: "employeeNumber",
		includeZeroHours: false,
		includeStunden: true,
		includeStundensatz: false,
	};

	it("sums the month's payouts as hours under the Lexware code mapped to overtime", () => {
		const result = new LexwareLohnFormatter().transform(
			[],
			[],
			[],
			[overtimeMapping({ lexwareWageTypeCode: "300" })],
			config,
			[payout(), payout({ id: "payout-2", day: "2026-09-28", minutes: 90 })],
		);

		expect(rows(result.content)).toEqual([
			"Jahr;Monat;Personalnummer;Lohnartennummer;Wert;Stunden",
			"2026;09;P-1;300;6,50;6,50",
		]);
		expect(result.metadata.unmappedOvertimePayouts).toEqual([]);
	});

	it("emits no line without a Lexware code for overtime and reports the payouts as unmapped", () => {
		const result = new LexwareLohnFormatter().transform(
			[],
			[],
			[],
			[overtimeMapping({ datevWageTypeCode: "1900" })],
			config,
			[payout()],
		);

		expect(rows(result.content)).toEqual([
			"Jahr;Monat;Personalnummer;Lohnartennummer;Wert;Stunden",
		]);
		expect(result.metadata.unmappedOvertimePayouts).toEqual([
			{ id: "payout-1", employeeId: "employee-1", day: "2026-09-15", minutes: 300 },
		]);
	});
});

describe("Sage Lohn overtime payouts", () => {
	it("writes the payout's hours under the Sage code in the output format's decimals", () => {
		const mappings = [overtimeMapping({ sageWageTypeCode: "2900" })];
		const native = new SageLohnFormatter().transform(
			[],
			[],
			[],
			mappings,
			{ personnelNumberType: "employeeNumber", outputFormat: "sage_native" },
			[payout()],
		);
		const datevCompatible = new SageLohnFormatter().transform(
			[],
			[],
			[],
			mappings,
			{ personnelNumberType: "employeeNumber", outputFormat: "datev_compatible" },
			[payout()],
		);

		expect(rows(native.content)[1]).toBe(
			'"P-1";"2900";"5,00";"2026-09-15";"Überstundenauszahlung"',
		);
		expect(rows(datevCompatible.content)[1]).toBe(
			'"P-1";"2900";"5.00";"2026-09-15";"Überstundenauszahlung"',
		);
		expect(native.metadata.unmappedOvertimePayouts).toEqual([]);
	});

	it("emits no line without a Sage code for overtime and reports the payouts as unmapped", () => {
		const result = new SageLohnFormatter().transform(
			[],
			[],
			[],
			[],
			{ personnelNumberType: "employeeNumber", outputFormat: "sage_native" },
			[payout()],
		);

		expect(rows(result.content)).toHaveLength(1);
		expect(result.metadata.unmappedOvertimePayouts).toEqual([
			{ id: "payout-1", employeeId: "employee-1", day: "2026-09-15", minutes: 300 },
		]);
	});
});
