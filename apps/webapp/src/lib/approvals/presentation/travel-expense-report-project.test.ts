import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import { travelExpenseReportProjectRows } from "./travel-expense-report-project";

const item = {
	itemId: "train",
	position: 0,
	type: "receipt",
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Train",
	original: { amount: "89.90", currency: "EUR" },
	paidBy: "employee",
	accountingReference: null,
	receipts: [],
} satisfies TravelExpenseReportSubmittedItem;

const value = (rows: ReturnType<typeof travelExpenseReportProjectRows>) =>
	rows.map((row) => [
		typeof row.label === "string" ? row.label : row.label.fallback,
		typeof row.value === "string" ? row.value : row.value.fallback,
	]);

describe("travelExpenseReportProjectRows", () => {
	it("shows nothing for an expense without a project", () => {
		expect(travelExpenseReportProjectRows(item)).toEqual([]);
	});

	it("names the frozen project and the assignment that proved it", () => {
		expect(
			value(
				travelExpenseReportProjectRows({
					...item,
					project: {
						projectId: "p1",
						name: "Hamburg rollout",
						customerId: "c1",
						customerName: "Hanse AG",
						inheritedFromTrip: true,
						basis: "team_assignment",
					},
				}),
			),
		).toEqual([
			["Project", "Hamburg rollout · Hanse AG (trip project)"],
			["Project eligibility", "Team assigned to the project on the expense date"],
		]);
	});

	it("spells out an attribution exception with its reason and evidence", () => {
		expect(
			value(
				travelExpenseReportProjectRows({
					...item,
					project: {
						projectId: "p2",
						name: "Legacy migration",
						customerId: null,
						customerName: null,
						inheritedFromTrip: false,
						basis: "exception",
						exception: {
							exceptionId: "x1",
							validFrom: "2026-09-01",
							validTo: "2026-09-30",
							reason: "Staffed before assignments were recorded",
							evidence: "Staffing plan Q3",
							authorizedByEmployeeId: "admin-1",
							authorizedAt: "2026-10-01T09:00:00Z",
						},
					},
				}),
			),
		).toEqual([
			["Project", "Legacy migration"],
			[
				"Project eligibility",
				"Authorized attribution exception — not proven by assignment history",
			],
			["Exception covers", "2026-09-01 – 2026-09-30"],
			["Exception reason", "Staffed before assignments were recorded"],
			["Exception evidence", "Staffing plan Q3"],
		]);
	});
});
