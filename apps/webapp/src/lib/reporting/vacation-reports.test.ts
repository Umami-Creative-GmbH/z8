import { describe, expect, it } from "vitest";
import {
	exportVacationBalanceAsCsv,
	formatVacationBalanceAsHtml,
	type IndividualBalanceReport,
} from "./vacation-reports";

function unavailable(status: "missing" | "conflict"): IndividualBalanceReport {
	return {
		employeeId: status,
		employeeName:
			status === "missing" ? "Missing Employee" : "Conflict Employee",
		email: "",
		configuration: {
			status,
			periods: [{ startDate: "2027-01-01", endDate: "2027-12-31" }],
		},
		totalAllowance: null,
		carryover: null,
		adjustments: null,
		used: null,
		pending: null,
		remaining: null,
		carryoverExpiryDate: null,
		utilizationRate: null,
	};
}
const resolved: IndividualBalanceReport = {
	employeeId: "resolved",
	employeeName: 'Alice "A" <Admin>',
	email: "",
	configuration: { status: "resolved" },
	totalAllowance: 25,
	carryover: 0,
	adjustments: 0,
	used: 5,
	pending: 0,
	remaining: 20,
	carryoverExpiryDate: null,
	utilizationRate: 20,
};

describe("vacation balance exports", () => {
	it("keeps missing and conflicting employees visible without reporting zero balances", () => {
		const csv = exportVacationBalanceAsCsv(
			[resolved, unavailable("missing"), unavailable("conflict")],
			2027,
		);
		expect(csv).toContain(
			'"Missing Employee",Missing vacation policy,N/A,N/A,N/A,N/A,N/A,N/A,N/A,N/A',
		);
		expect(csv).toContain(
			'"Conflict Employee",Conflicting vacation policies,N/A,N/A,N/A,N/A,N/A,N/A,N/A,N/A',
		);
		expect(csv).toContain(
			'"Alice ""A"" <Admin>",Resolved,25.0,0.0,0.0,5.0,0.0,20.0,20%,N/A',
		);
		expect(csv).toContain("Employees Requiring Policy Review,2");
		expect(csv).toContain(
			"Totals include employees with resolved balances only",
		);
		expect(csv).toContain("Total Allowance,25.0");
	});

	it("shows unavailable HTML balances and distinguishes partial totals", () => {
		const html = formatVacationBalanceAsHtml(
			[resolved, unavailable("missing"), unavailable("conflict")],
			2027,
			"Example & Co",
		);
		expect(html).toContain("Missing vacation policy");
		expect(html).toContain("Conflicting vacation policies");
		expect(html).toContain("2 employees require policy review");
		expect(html).toContain(
			"Totals include employees with resolved balances only",
		);
		expect(html).toContain("Alice &quot;A&quot; &lt;Admin&gt;");
		expect(html).toContain("Example &amp; Co");
		expect(html).not.toContain("null");
	});
});
