import { describe, expect, it } from "vitest";
import {
	exportExpirationReportAsCsv,
	exportVacationBalanceAsCsv,
	formatExpirationWarningEmail,
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

describe("carryover expiration report timezone", () => {
	it("exports the organization-local frozen expiry day independently of viewer timezone", () => {
		const csv = exportExpirationReportAsCsv([
			{
				employeeId: "employee-1",
				employeeName: "West Coast Employee",
				carryoverDays: 4,
				expiresAt: new Date("2027-04-01T06:59:59.999Z"),
				timezone: "America/Los_Angeles",
				daysUntilExpiry: 5,
				urgency: "critical",
			},
		]);
		expect(csv).toContain('"West Coast Employee",4.0,2027-03-31,5,critical');
	});
});

describe("carryover expiration email timezone", () => {
	it.each(["critical", "warning"] as const)(
		"formats %s expiry in its frozen transfer zone",
		(urgency) => {
			const html = formatExpirationWarningEmail(
				[
					{
						employeeId: "employee-1",
						employeeName: "West Coast Employee",
						carryoverDays: 4,
						expiresAt: new Date("2027-04-01T06:59:59.999Z"),
						timezone: "America/Los_Angeles",
						daysUntilExpiry: 5,
						urgency,
					},
				],
				"Example Co",
			);
			expect(html).toContain("days expiring on March 31, 2027");
		},
	);
});

describe("balance report carryover expiry timezone", () => {
	it("exports the frozen calendar day in the balance expiry column", () => {
		const csv = exportVacationBalanceAsCsv(
			[
				{
					...resolved,
					carryover: 4,
					carryoverExpiryDate: new Date("2027-04-01T06:59:59.999Z"),
					timezone: "America/Los_Angeles",
				},
			],
			2027,
		);
		expect(csv).toContain("20%,2027-03-31");
	});
});
