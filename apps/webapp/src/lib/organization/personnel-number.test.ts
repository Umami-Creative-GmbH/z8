import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	normalizePersonnelNumber,
	PERSONNEL_NUMBER_WHITESPACE,
	PERSONNEL_NUMBER_WHITESPACE_SQL,
	personnelNumberKey,
} from "./personnel-number";

describe("PERSONNEL_NUMBER_WHITESPACE", () => {
	it("is exactly the characters a normalized number loses at its ends", () => {
		const stripped: string[] = [];
		for (let code = 0; code <= 0xffff; code += 1) {
			const character = String.fromCharCode(code);
			if (normalizePersonnelNumber(`${character}E-42${character}`) === "E-42") {
				stripped.push(character);
			}
		}
		expect([...PERSONNEL_NUMBER_WHITESPACE].sort()).toEqual(stripped.sort());
	});

	it("is the trim set of migration 0232 and the unique index", () => {
		const migration = readFileSync(
			join(process.cwd(), "drizzle/0232_employee_personnel_number_unique.sql"),
			"utf8",
		);
		const literals = [...migration.matchAll(/E'((?:\\u[0-9a-f]{4})+)'/g)].map((match) =>
			match[1].replace(/\\u([0-9a-f]{4})/g, (_escape, hex: string) =>
				String.fromCharCode(Number.parseInt(hex, 16)),
			),
		);
		expect(literals).toHaveLength(5);
		for (const literal of literals) expect(literal).toBe(PERSONNEL_NUMBER_WHITESPACE);
		// The operator's clash check (docs note) trims the same way.
		expect(
			readFileSync(join(process.cwd(), "../../docs/personnel-number-uniqueness-881.md"), "utf8"),
		).toContain(PERSONNEL_NUMBER_WHITESPACE_SQL);
		expect(PERSONNEL_NUMBER_WHITESPACE_SQL).toBe(
			`E'${migration.match(/E'((?:\\u[0-9a-f]{4})+)'/)?.[1]}'`,
		);
	});
});

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
