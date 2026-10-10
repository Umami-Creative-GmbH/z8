import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "@/lib/approvals/evidence/travel-expense-report-facts";
import type { PayrollRevision } from "../payroll-lines";
import { classifyPayrollRunCandidate } from "../payroll-run-classification";

/*
 * Which reports a payroll run takes and why it leaves the others out (#852,
 * #854): the one classification both the export and payroll readiness use.
 */

const PERIOD = { startDate: "2026-10-01", endDate: "2026-10-31" };
const ALL_MAPPED = new Map([
	["receipt_accommodation", "9100"],
	["receipt_transport", "9200"],
	["mileage_statutory", "9300"],
	["mileage_excess", "9301"],
]);

function receipt(
	itemId: string,
	category: TravelExpenseReportSubmittedItem["category"],
	amount: string,
): TravelExpenseReportSubmittedItem {
	return {
		itemId,
		position: 0,
		type: "receipt",
		expenseDate: "2026-10-02",
		category,
		description: `Receipt ${itemId}`,
		original: { amount, currency: "EUR" },
		paidBy: "employee",
		accountingReference: null,
		receipts: [],
	};
}

/** A mileage allowance an expense administrator set by hand (#610): no statutory baseline. */
function overriddenMileage(itemId: string, amount: string): TravelExpenseReportSubmittedItem {
	return {
		...receipt(itemId, "transport", amount),
		type: "mileage",
		description: "Office – customer – back",
		allowanceOverride: {
			overrideId: `override-${itemId}`,
			amount,
			currency: "EUR",
		} as TravelExpenseReportSubmittedItem["allowanceOverride"],
	};
}

function facts(items: TravelExpenseReportSubmittedItem[], currency = "EUR"): PayrollRevision {
	return { reimbursementCurrency: currency, trip: null, items };
}

type Input = Parameters<typeof classifyPayrollRunCandidate>[0];

function report(overrides: Partial<Input> = {}): Input {
	return {
		account: { source: { type: "report", id: "report-1" }, entries: [], payrollRun: null },
		revision: { id: "revision-1", facts: facts([receipt("hotel", "accommodation", "100.00")]) },
		format: "datev_lohn",
		period: PERIOD,
		codes: ALL_MAPPED,
		priorLines: [],
		...overrides,
	};
}

const run = (periodStart: string, periodEnd: string) => ({
	jobId: "job-1",
	formatId: "datev_lohn",
	formatName: "DATEV Lohn & Gehalt",
	periodStart,
	periodEnd,
	includedAt: "2026-10-01T10:00:00Z",
	partlyConfirmed: false,
});

describe("classifyPayrollRunCandidate", () => {
	it("includes a report whose every line kind is mapped, with the format's codes", () => {
		expect(classifyPayrollRunCandidate(report())).toEqual({
			outcome: "include",
			basisRevisionId: "revision-1",
			takesOver: false,
			lines: [
				{ kind: "receipt_accommodation", amount: "100.00", currency: "EUR", wageTypeCode: "9100" },
			],
		});
	});

	it("leaves everything out for an API connector", () => {
		expect(classifyPayrollRunCandidate(report({ format: "personio" }))).toEqual({
			outcome: "skip",
			skip: { reason: "api_connector" },
		});
	});

	it("never takes a legacy claim", () => {
		expect(
			classifyPayrollRunCandidate(
				report({
					account: {
						source: { type: "legacy_claim", id: "claim-1" },
						entries: [],
						payrollRun: null,
					},
					revision: null,
				}),
			),
		).toEqual({ outcome: "skip", skip: { reason: "legacy_claim" } });
	});

	it("names the unconfirmed run of another period that holds the report", () => {
		const held = run("2026-09-01", "2026-09-30");

		expect(
			classifyPayrollRunCandidate(
				report({
					account: { source: { type: "report", id: "report-1" }, entries: [], payrollRun: held },
				}),
			),
		).toEqual({ outcome: "skip", skip: { reason: "included_in_other_run", run: held } });
	});

	it("takes over a report an unconfirmed run of the same period holds", () => {
		const held = run(PERIOD.startDate, PERIOD.endDate);

		expect(
			classifyPayrollRunCandidate(
				report({
					account: { source: { type: "report", id: "report-1" }, entries: [], payrollRun: held },
				}),
			),
		).toMatchObject({ outcome: "include", takesOver: true });
	});

	it("never takes over a report a run of the same period holds once that run is partly confirmed", () => {
		// Payroll already paid that run's file: another file could pay the report twice.
		const held = { ...run(PERIOD.startDate, PERIOD.endDate), partlyConfirmed: true };

		expect(
			classifyPayrollRunCandidate(
				report({
					account: { source: { type: "report", id: "report-1" }, entries: [], payrollRun: held },
				}),
			),
		).toEqual({ outcome: "skip", skip: { reason: "included_in_other_run", run: held } });
	});

	it("leaves out a report in another currency", () => {
		expect(
			classifyPayrollRunCandidate(
				report({
					revision: { id: "r", facts: facts([receipt("hotel", "accommodation", "90.00")], "CHF") },
				}),
			),
		).toEqual({ outcome: "skip", skip: { reason: "currency_not_eur" } });
	});

	it("leaves out a report reimbursed or recovered outside payroll", () => {
		const entry = (kind: "reimbursement" | "recovery") =>
			({ kind }) as Input["account"]["entries"][number];

		for (const kind of ["reimbursement", "recovery"] as const) {
			expect(
				classifyPayrollRunCandidate(
					report({
						account: {
							source: { type: "report", id: "report-1" },
							entries: [entry(kind)],
							payrollRun: null,
						},
					}),
				),
			).toEqual({ outcome: "skip", skip: { reason: "reimbursed_outside_payroll" } });
		}
	});

	it("names the items without a statutory baseline, with their date and description", () => {
		const items = [
			receipt("hotel", "accommodation", "100.00"),
			overriddenMileage("drive", "18.45"),
		];

		expect(
			classifyPayrollRunCandidate(report({ revision: { id: "r", facts: facts(items) } })),
		).toEqual({
			outcome: "skip",
			skip: {
				reason: "no_statutory_baseline",
				items: [
					{
						itemId: "drive",
						cause: "allowance_override",
						type: "mileage",
						expenseDate: "2026-10-02",
						description: "Office – customer – back",
					},
				],
			},
		});
	});

	it("names the kinds whose difference to earlier runs is negative", () => {
		expect(
			classifyPayrollRunCandidate(
				report({
					priorLines: [{ kind: "receipt_transport", amount: "5.00", currency: "EUR" }],
				}),
			),
		).toEqual({
			outcome: "skip",
			skip: { reason: "negative_difference", kinds: ["receipt_transport"] },
		});
	});

	it("leaves out a report payroll lines carry nothing for", () => {
		expect(
			classifyPayrollRunCandidate(
				report({
					priorLines: [{ kind: "receipt_accommodation", amount: "100.00", currency: "EUR" }],
				}),
			),
		).toEqual({ outcome: "skip", skip: { reason: "nothing_owed" } });
	});

	it("names every kind the format has no wage type for", () => {
		const items = [
			receipt("hotel", "accommodation", "100.00"),
			receipt("dinner", "meals", "30.00"),
			receipt("garage", "parking", "12.00"),
		];

		expect(
			classifyPayrollRunCandidate(report({ revision: { id: "r", facts: facts(items) } })),
		).toEqual({
			outcome: "skip",
			skip: { reason: "unmapped_wage_type", kinds: ["receipt_meals", "receipt_parking"] },
		});
	});
});
