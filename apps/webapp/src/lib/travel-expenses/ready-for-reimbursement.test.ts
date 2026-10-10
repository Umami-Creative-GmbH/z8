import { describe, expect, it } from "vitest";
import { ALL_OFFICER_SCOPE, coveringOfficers, type ReimbursingOfficer } from "./officer-scope";
import {
	buildReadyForReimbursementNotification,
	leftOutOfPayrollRun,
	readyForReimbursement,
} from "./ready-for-reimbursement";
import { computeSettlement, type EntitlementComponent } from "./settlement";
import type { SettlementAccount, SettlementEntryView } from "./settlement-store";

function account(
	overrides: Partial<SettlementAccount> & {
		entitlement?: EntitlementComponent[];
		entries?: SettlementEntryView[];
	} = {},
): SettlementAccount {
	const entitlement = overrides.entitlement ?? [
		{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "89.90" },
	];
	const entries = overrides.entries ?? [];
	return {
		source: { type: "report", id: "report-1" },
		organizationId: "org-1",
		employeeId: "employee-1",
		employeeName: "Erin Employee",
		approved: true,
		currency: "EUR",
		basis: {
			evidence: "frozen_revision",
			revisionId: "revision-1",
			submissionCycle: 1,
			approvedAt: "2026-10-01T08:00:00Z",
			approvalBasis: null,
			companyPaid: "0.00",
		},
		title: { kind: "trip", purpose: "Customer workshop", startDate: null, endDate: null },
		adjustments: [],
		adjustmentOf: null,
		adjustmentDelta: null,
		...overrides,
		entitlement,
		entries,
		summary: computeSettlement({ entitlement, entries }),
	};
}

function reimbursed(amount: string): SettlementEntryView {
	return {
		id: `entry-${amount}`,
		kind: "reimbursement",
		amount,
		currency: "EUR",
		occurredOn: "2026-10-02",
		reference: "SEPA-1",
		note: null,
		balanceBefore: amount,
		recordedAt: "2026-10-02T08:00:00Z",
		recordedByUserId: null,
		recordedByName: null,
		exportBatch: null,
	};
}

/** An approved adjustment report (#615): no account of its own, only its delta. */
function adjustment(delta: string): SettlementAccount {
	return account({
		source: { type: "report", id: "adjustment-1" },
		basis: {
			evidence: "frozen_revision",
			revisionId: "revision-adjustment",
			submissionCycle: 1,
			approvedAt: "2026-10-05T08:00:00Z",
			approvalBasis: null,
			companyPaid: "0.00",
		},
		entitlement: [],
		adjustmentOf: "report-1",
		adjustmentDelta: delta,
	});
}

describe("readyForReimbursement (#756)", () => {
	it("is due for a newly approved report with an amount owed", () => {
		const approved = account();
		expect(readyForReimbursement(approved, approved)).toEqual({
			kind: "approved",
			account: approved,
			revisionId: "revision-1",
			awaiting: [{ currency: "EUR", amount: "89.90" }],
		});
	});

	it("is not due when nothing is owed to the employee", () => {
		const companyPaid = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "0.00" },
			],
		});
		expect(readyForReimbursement(companyPaid, companyPaid)).toBeNull();
	});

	it("is due when an approved adjustment raises the amount owed, with what the account now awaits", () => {
		const original = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "500.00" },
				{
					kind: "approved_adjustment",
					id: "revision-adjustment",
					currency: "EUR",
					amount: "100.00",
				},
			],
			entries: [reimbursed("500.00")],
		});
		expect(readyForReimbursement(adjustment("100.00"), original)).toEqual({
			kind: "adjustment",
			account: original,
			revisionId: "revision-adjustment",
			awaiting: [{ currency: "EUR", amount: "100.00" }],
		});
	});

	it("is not due for an adjustment that lowers the amount owed", () => {
		const original = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "500.00" },
				{
					kind: "approved_adjustment",
					id: "revision-adjustment",
					currency: "EUR",
					amount: "-100.00",
				},
			],
		});
		expect(readyForReimbursement(adjustment("-100.00"), original)).toBeNull();
	});

	it("is not due for an adjustment that raises the amount owed while the account is still overpaid", () => {
		const original = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "500.00" },
				{ kind: "approved_adjustment", id: "revision-earlier", currency: "EUR", amount: "-200.00" },
				{
					kind: "approved_adjustment",
					id: "revision-adjustment",
					currency: "EUR",
					amount: "50.00",
				},
			],
			entries: [reimbursed("500.00")],
		});
		expect(readyForReimbursement(adjustment("50.00"), original)).toBeNull();
	});

	it("is not due for a report that is not approved", () => {
		const draft = account({ approved: false, basis: null, entitlement: [] });
		expect(readyForReimbursement(draft, draft)).toBeNull();
	});
});

describe("coveringOfficers (#756)", () => {
	const berlin: ReimbursingOfficer = {
		officerEmployeeId: "officer-berlin",
		userId: "user-berlin",
		scope: { kind: "specific", teamIds: ["team-berlin"], employeeIds: [] },
	};
	const everyone: ReimbursingOfficer = {
		officerEmployeeId: "officer-all",
		userId: "user-all",
		scope: ALL_OFFICER_SCOPE,
	};
	const munich: ReimbursingOfficer = {
		officerEmployeeId: "officer-munich",
		userId: "user-munich",
		scope: { kind: "specific", teamIds: ["team-munich"], employeeIds: ["employee-named"] },
	};

	it("covers a report with the officers whose scope includes it", () => {
		expect(
			coveringOfficers([berlin, everyone, munich], {
				employeeId: "employee-1",
				approvalTeamIds: ["team-berlin"],
			}),
		).toEqual([berlin, everyone]);
		expect(
			coveringOfficers([berlin, munich], { employeeId: "employee-named", approvalTeamIds: [] }),
		).toEqual([munich]);
	});

	it("never covers an officer's own report with that officer", () => {
		expect(
			coveringOfficers([berlin, everyone], {
				employeeId: "officer-all",
				approvalTeamIds: ["team-berlin"],
			}),
		).toEqual([berlin]);
	});
});

describe("buildReadyForReimbursementNotification (#756)", () => {
	it("names the employee, the report and what awaits reimbursement per currency, and links the report", () => {
		const approved = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "89.90" },
				{ kind: "approved_adjustment", id: "revision-2", currency: "CHF", amount: "12.50" },
			],
		});
		const due = readyForReimbursement(approved, approved);
		if (!due) throw new Error("not due");
		const notification = buildReadyForReimbursementNotification(due, {
			userId: "user-berlin",
		});

		expect(notification).toMatchObject({
			userId: "user-berlin",
			organizationId: "org-1",
			type: "travel_expense_ready_for_reimbursement",
			title: "Ready for reimbursement",
			message:
				"Erin Employee's expense report Customer workshop is approved. Awaiting reimbursement: 12.50 CHF, 89.90 EUR.",
			entityType: "travel_expense_report",
			entityId: "report-1",
			actionUrl: "/travel-expenses/reports/report-1",
			idempotencyKey: "travel-expense-ready-for-reimbursement:revision-1:user-berlin",
		});
		expect(notification.metadata?.i18n).toEqual({
			titleKey: "common:notifications.content.travelExpenseReadyForReimbursement.title",
			titleDefault: "Ready for reimbursement",
			messageKey: "common:notifications.content.travelExpenseReadyForReimbursement.message",
			messageDefault:
				"{employee}'s expense report {report} is approved. Awaiting reimbursement: {amounts}.",
			params: {
				employee: "Erin Employee",
				report: "Customer workshop",
				amounts: "12.50 CHF, 89.90 EUR",
			},
		});
	});

	it("tells of an adjustment on the original report, keyed by the adjustment's revision", () => {
		const original = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision-1", currency: "EUR", amount: "500.00" },
				{
					kind: "approved_adjustment",
					id: "revision-adjustment",
					currency: "EUR",
					amount: "100.00",
				},
			],
			entries: [reimbursed("500.00")],
			title: { kind: "standalone", description: null, expenseDate: "2026-09-14" },
			employeeName: null,
		});
		const due = readyForReimbursement(adjustment("100.00"), original);
		if (!due) throw new Error("not due");
		const notification = buildReadyForReimbursementNotification(due, { userId: "user-all" });

		expect(notification).toMatchObject({
			message:
				"An approved adjustment raised what is owed on an employee's expense report Untitled receipt. Awaiting reimbursement: 100.00 EUR.",
			entityId: "report-1",
			actionUrl: "/travel-expenses/reports/report-1",
			idempotencyKey: "travel-expense-ready-for-reimbursement:revision-adjustment:user-all",
		});
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey:
				"common:notifications.content.travelExpenseAdjustmentReadyForReimbursement.message",
		});
	});
});

describe("leftOutOfPayrollRun (#855)", () => {
	const run = {
		jobId: "job-1",
		formatId: "datev_lohn",
		formatName: "DATEV Lohn & Gehalt",
		periodStart: "2026-10-01",
		periodEnd: "2026-10-31",
		includedAt: "2026-10-31T08:00:00Z",
		partlyConfirmed: false,
	};

	it("is due for an approved report no run carries, keyed like its approval", () => {
		const approved = account({ payrollRun: null });
		const due = leftOutOfPayrollRun(approved, "revision-1");
		expect(due).toEqual({
			kind: "leftOut",
			account: approved,
			revisionId: "revision-1",
			awaiting: [{ currency: "EUR", amount: "89.90" }],
		});
		if (!due) throw new Error("not due");
		const notification = buildReadyForReimbursementNotification(due, { userId: "user-all" });
		expect(notification).toMatchObject({
			type: "travel_expense_ready_for_reimbursement",
			title: "Ready for reimbursement",
			message:
				"Erin Employee's expense report Customer workshop isn't reimbursed through a payroll run. Awaiting reimbursement: 89.90 EUR.",
			idempotencyKey: "travel-expense-ready-for-reimbursement:revision-1:user-all",
		});
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.travelExpenseLeftOutOfPayrollRun.message",
		});
	});

	it("is not due while an unconfirmed run includes the report", () => {
		expect(leftOutOfPayrollRun(account({ payrollRun: run }), "revision-1")).toBeNull();
	});

	it("is not due when nothing awaits reimbursement", () => {
		expect(
			leftOutOfPayrollRun(
				account({ payrollRun: null, entries: [reimbursed("89.90")] }),
				"revision-1",
			),
		).toBeNull();
	});
});
