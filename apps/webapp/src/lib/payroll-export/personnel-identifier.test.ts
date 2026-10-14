/**
 * #1198: two employees an export would write under one personnel identifier are
 * found with the personnel number comparison rule of #881 (trimmed, case
 * ignored, leading zeros count). One employee on several rows is no clash.
 */

import { describe, expect, it } from "vitest";
import { findDuplicatePersonnelIdentifiers } from "./personnel-identifier";

type Row = { employeeId: string; written: string | null };
const written = (row: Row) => row.written;

describe("findDuplicatePersonnelIdentifiers", () => {
	it("finds two employees whose identifiers differ only in case or surrounding spaces", () => {
		const rows: Row[] = [
			{ employeeId: "employee-b", written: " e-42 " },
			{ employeeId: "employee-a", written: "E-42" },
			{ employeeId: "employee-c", written: "E-7" },
		];

		expect(findDuplicatePersonnelIdentifiers(rows, written)).toEqual([
			{
				employees: [
					{ employeeId: "employee-a", identifier: "E-42" },
					{ employeeId: "employee-b", identifier: " e-42 " },
				],
			},
		]);
	});

	it("does not flag 0042 against 42", () => {
		const rows: Row[] = [
			{ employeeId: "employee-a", written: "0042" },
			{ employeeId: "employee-b", written: "42" },
		];

		expect(findDuplicatePersonnelIdentifiers(rows, written)).toEqual([]);
	});

	it("does not flag one employee who appears on several rows", () => {
		const rows: Row[] = [
			{ employeeId: "employee-a", written: "E-42" },
			{ employeeId: "employee-a", written: "E-42" },
			{ employeeId: "employee-a", written: "e-42" },
		];

		expect(findDuplicatePersonnelIdentifiers(rows, written)).toEqual([]);
	});

	it("lists every clash, three employees on one identifier included, and skips rows without one", () => {
		const rows: Row[] = [
			{ employeeId: "employee-d", written: "B-1" },
			{ employeeId: "employee-a", written: "A-1" },
			{ employeeId: "employee-c", written: "a-1" },
			{ employeeId: "employee-b", written: "A-1" },
			{ employeeId: "employee-e", written: "b-1" },
			{ employeeId: "employee-f", written: null },
			{ employeeId: "employee-g", written: "  " },
		];

		expect(findDuplicatePersonnelIdentifiers(rows, written)).toEqual([
			{
				employees: [
					{ employeeId: "employee-a", identifier: "A-1" },
					{ employeeId: "employee-b", identifier: "A-1" },
					{ employeeId: "employee-c", identifier: "a-1" },
				],
			},
			{
				employees: [
					{ employeeId: "employee-d", identifier: "B-1" },
					{ employeeId: "employee-e", identifier: "b-1" },
				],
			},
		]);
	});
});
