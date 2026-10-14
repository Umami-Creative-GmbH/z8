import { describe, expect, it } from "vitest";
import { normalizePersonnelNumber, personnelNumberKey } from "./personnel-number";

describe("normalizePersonnelNumber", () => {
	it("trims surrounding spaces and keeps the original case", () => {
		expect(normalizePersonnelNumber(" E-42 ")).toBe("E-42");
		expect(normalizePersonnelNumber("\tAbC-7\n")).toBe("AbC-7");
	});

	it("turns an empty or whitespace-only value into no number", () => {
		expect(normalizePersonnelNumber("")).toBeNull();
		expect(normalizePersonnelNumber("   ")).toBeNull();
		expect(normalizePersonnelNumber(null)).toBeNull();
		expect(normalizePersonnelNumber(undefined)).toBeNull();
	});
});

describe("personnelNumberKey", () => {
	it("gives numbers that differ only in case or surrounding spaces the same key", () => {
		expect(personnelNumberKey("E-42")).toBe(personnelNumberKey("e-42"));
		expect(personnelNumberKey(" E-42 ")).toBe(personnelNumberKey("e-42"));
	});

	it("keeps leading zeros significant", () => {
		expect(personnelNumberKey("0042")).not.toBe(personnelNumberKey("42"));
	});

	it("has no key for no number", () => {
		expect(personnelNumberKey("")).toBeNull();
		expect(personnelNumberKey("   ")).toBeNull();
		expect(personnelNumberKey(null)).toBeNull();
		expect(personnelNumberKey(undefined)).toBeNull();
	});

	it("is the lowercase of the trimmed number", () => {
		expect(personnelNumberKey(" Ab-0042 ")).toBe("ab-0042");
	});
});
