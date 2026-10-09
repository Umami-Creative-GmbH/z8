import { describe, expect, it } from "vitest";
import { matchPayslipFile } from "./payslip-matching";

const anna = { employeeId: "anna", personnelNumber: "0042" };
const ben = { employeeId: "ben", personnelNumber: "00421" };
const carla = { employeeId: "carla", personnelNumber: "7" };

describe("matchPayslipFile", () => {
	it("matches the employee whose personnel number is a whole token of the file name", () => {
		expect(matchPayslipFile("0042_payslip.pdf", [anna, ben])).toEqual({
			kind: "matched",
			employeeId: "anna",
		});
	});

	it("does not match a number that is only part of a longer token", () => {
		expect(matchPayslipFile("00421_payslip.pdf", [anna])).toEqual({ kind: "unmatched" });
		expect(matchPayslipFile("payslip-x0042.pdf", [anna])).toEqual({ kind: "unmatched" });
		expect(matchPayslipFile("00421_payslip.pdf", [anna, ben])).toEqual({
			kind: "matched",
			employeeId: "ben",
		});
	});

	it("accepts the start, the end and any non-alphanumeric character as a delimiter", () => {
		for (const name of ["0042.pdf", "Lohn 2026-09 0042.pdf", "x.0042", "(0042)", "a+0042+b.pdf"]) {
			expect(matchPayslipFile(name, [anna])).toEqual({ kind: "matched", employeeId: "anna" });
		}
	});

	it("keeps leading zeros significant", () => {
		expect(matchPayslipFile("42_payslip.pdf", [anna])).toEqual({ kind: "unmatched" });
	});

	it("ignores the file extension and folders of the name", () => {
		const pdfNumber = { employeeId: "pdf", personnelNumber: "pdf" };
		expect(matchPayslipFile("payslip.pdf", [pdfNumber])).toEqual({ kind: "unmatched" });
		expect(matchPayslipFile("0042/payslip.pdf", [anna])).toEqual({ kind: "unmatched" });
		expect(matchPayslipFile("2026-09/0042.pdf", [anna])).toEqual({
			kind: "matched",
			employeeId: "anna",
		});
	});

	it("is ambiguous when two employees share the number", () => {
		const anotherAnna = { employeeId: "anna-2", personnelNumber: "0042" };
		expect(matchPayslipFile("0042.pdf", [anna, anotherAnna])).toEqual({
			kind: "ambiguous",
			employeeIds: ["anna", "anna-2"],
		});
	});

	it("is ambiguous when tokens match different employees", () => {
		expect(matchPayslipFile("0042_7.pdf", [anna, carla])).toEqual({
			kind: "ambiguous",
			employeeIds: ["anna", "carla"],
		});
	});

	it("matches one employee whose number appears twice", () => {
		expect(matchPayslipFile("0042_0042.pdf", [anna])).toEqual({
			kind: "matched",
			employeeId: "anna",
		});
	});

	it("never matches employees without a personnel number", () => {
		const blank = [
			{ employeeId: "none", personnelNumber: null },
			{ employeeId: "empty", personnelNumber: "  " },
		];
		expect(matchPayslipFile("payslip.pdf", blank)).toEqual({ kind: "unmatched" });
		expect(matchPayslipFile(" .pdf", blank)).toEqual({ kind: "unmatched" });
	});

	it("trims personnel numbers and matches letters case-insensitively", () => {
		const lettered = { employeeId: "dora", personnelNumber: " AB-12 " };
		expect(matchPayslipFile("ab-12_payslip.pdf", [lettered])).toEqual({
			kind: "matched",
			employeeId: "dora",
		});
		expect(matchPayslipFile("xab-12.pdf", [lettered])).toEqual({ kind: "unmatched" });
	});
});
