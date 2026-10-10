import { describe, expect, it } from "vitest";
import {
	isPayrollExportFormatId,
	isPayrollWorkspaceExportFormatId,
	payrollExportFileFormatIds,
	payrollExportFormatIds,
	payrollExportFormatKind,
	payrollWorkspaceExportFormatIds,
} from "./format-registry";

describe("payroll export format registry", () => {
	it("knows every registered format id with its kind", () => {
		expect(payrollExportFormatIds()).toEqual([
			"datev_lohn",
			"lexware_lohn",
			"sage_lohn",
			"personio",
			"successfactors_api",
			"successfactors_csv",
			"workday_api",
		]);
		expect(payrollExportFormatKind("datev_lohn")).toBe("file");
		expect(payrollExportFormatKind("successfactors_csv")).toBe("file");
		expect(payrollExportFormatKind("successfactors_api")).toBe("api");
		expect(payrollExportFormatKind("workday_api")).toBe("api");
		expect(payrollExportFormatKind("sage")).toBeUndefined();
	});

	it("tells known format ids from unknown ones", () => {
		expect(isPayrollExportFormatId("workday_api")).toBe(true);
		expect(isPayrollExportFormatId("lexware")).toBe(false);
		expect(isPayrollExportFormatId(undefined)).toBe(false);
	});

	it("lists the file formats, which carry expense lines", () => {
		expect(payrollExportFileFormatIds()).toEqual([
			"datev_lohn",
			"lexware_lohn",
			"sage_lohn",
			"successfactors_csv",
		]);
	});

	it("offers the payroll workspace its file-format subset", () => {
		expect(payrollWorkspaceExportFormatIds()).toEqual(["datev_lohn", "lexware_lohn", "sage_lohn"]);
		expect(isPayrollWorkspaceExportFormatId("sage_lohn")).toBe(true);
		expect(isPayrollWorkspaceExportFormatId("successfactors_csv")).toBe(false);
		expect(isPayrollWorkspaceExportFormatId("personio")).toBe(false);
	});
});
