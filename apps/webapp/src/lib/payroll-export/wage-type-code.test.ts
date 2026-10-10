import { describe, expect, it } from "vitest";
import type { WageTypeMapping } from "./types";
import { legacyOnlyWageTypeCode, wageTypeCodeFor } from "./wage-type-code";

function mapping(codes: Partial<WageTypeMapping>): WageTypeMapping {
	return {
		id: "mapping-1",
		workCategoryId: "work-1",
		absenceCategoryId: null,
		specialCategory: null,
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

describe("wageTypeCodeFor (#816)", () => {
	it("reads each format's own column", () => {
		const row = mapping({
			wageTypeCode: "1100",
			datevWageTypeCode: "1100",
			lexwareWageTypeCode: "110",
			sageWageTypeCode: "2100",
			successFactorsTimeTypeCode: "NIGHT",
		});

		expect(wageTypeCodeFor(row, "datev")).toBe("1100");
		expect(wageTypeCodeFor(row, "lexware")).toBe("110");
		expect(wageTypeCodeFor(row, "sage")).toBe("2100");
		expect(wageTypeCodeFor(row, "successFactors")).toBe("NIGHT");
	});

	it("never borrows another format's code or the legacy code", () => {
		// What the settings form saves with only a DATEV code: the legacy code copies it.
		const row = mapping({ wageTypeCode: "1100", datevWageTypeCode: "1100" });

		expect(wageTypeCodeFor(row, "lexware")).toBeNull();
		expect(wageTypeCodeFor(row, "sage")).toBeNull();
		expect(wageTypeCodeFor(row, "successFactors")).toBeNull();
		expect(wageTypeCodeFor(undefined, "datev")).toBeNull();
	});
});

describe("legacyOnlyWageTypeCode", () => {
	it("returns the legacy code only for rows without format codes", () => {
		expect(legacyOnlyWageTypeCode(mapping({ wageTypeCode: "7" }))).toBe("7");
		expect(
			legacyOnlyWageTypeCode(mapping({ wageTypeCode: "1600", datevWageTypeCode: "1600" })),
		).toBeNull();
		expect(legacyOnlyWageTypeCode(mapping({}))).toBeNull();
	});
});
