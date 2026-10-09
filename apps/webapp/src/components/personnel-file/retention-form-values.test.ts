import { describe, expect, it } from "vitest";
import {
	parseRetentionYears,
	toRetentionFormValues,
	toRetentionPeriods,
} from "./retention-form-values";

describe("retention form values", () => {
	it("shows a missing period as an empty field", () => {
		expect(
			toRetentionFormValues({
				contract: 10,
				payslip: null,
				certificate: null,
				sick_note: 2,
				other: null,
			}),
		).toEqual({ contract: "10", payslip: "", certificate: "", sick_note: "2", other: "" });
	});

	it("reads whole years between 1 and 100; empty means no period", () => {
		expect(parseRetentionYears("")).toBeNull();
		expect(parseRetentionYears("  ")).toBeNull();
		expect(parseRetentionYears("6")).toBe(6);
		expect(parseRetentionYears(" 10 ")).toBe(10);
		expect(parseRetentionYears("0")).toBe("invalid");
		expect(parseRetentionYears("101")).toBe("invalid");
		expect(parseRetentionYears("2.5")).toBe("invalid");
		expect(parseRetentionYears("six")).toBe("invalid");
	});

	it("turns the fields into periods, or null when one is invalid", () => {
		expect(
			toRetentionPeriods({
				contract: "10",
				payslip: "",
				certificate: "5",
				sick_note: "",
				other: "",
			}),
		).toEqual({ contract: 10, payslip: null, certificate: 5, sick_note: null, other: null });
		expect(
			toRetentionPeriods({ contract: "x", payslip: "", certificate: "", sick_note: "", other: "" }),
		).toBeNull();
	});
});
