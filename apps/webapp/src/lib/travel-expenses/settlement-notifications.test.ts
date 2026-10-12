import { describe, expect, it } from "vitest";
import { computeSettlement, type EntitlementComponent } from "./settlement";
import { buildSettlementNotification } from "./settlement-notifications";
import type { SettlementAccount, SettlementEntryView, SettlementSource } from "./settlement-store";

function entry(
	kind: SettlementEntryView["kind"],
	amount: string,
	overrides: Partial<SettlementEntryView> = {},
): SettlementEntryView {
	return {
		id: `entry-${kind}-${amount}`,
		kind,
		amount,
		currency: "EUR",
		occurredOn: "2026-10-01",
		reference: "SEPA-4711",
		note: "Paid with the October run",
		balanceBefore: "0.00",
		recordedAt: "2026-10-02T08:00:00Z",
		recordedByUserId: "finance-user",
		recordedByName: "Fiona Finance",
		exportBatch: null,
		payrollRun: null,
		...overrides,
	};
}

/** The account as `recordSettlementEntry` returns it: the new entry already included. */
function account(
	entries: SettlementEntryView[],
	options: {
		source?: SettlementSource;
		entitlement?: string;
		/** An approved adjustment in another currency (#615). */
		adjustment?: { currency: string; amount: string };
	} = {},
): SettlementAccount {
	const entitlement: EntitlementComponent[] = [
		{
			kind: "approved_submission",
			id: "revision-1",
			currency: "EUR",
			amount: options.entitlement ?? "89.90",
		},
		...(options.adjustment
			? [{ kind: "approved_adjustment" as const, id: "revision-2", ...options.adjustment }]
			: []),
	];
	return {
		source: options.source ?? { type: "report", id: "report-1" },
		organizationId: "org-1",
		employeeId: "employee-1",
		employeeName: "Erin Employee",
		approved: true,
		currency: "EUR",
		basis: null,
		entitlement,
		entries,
		summary: computeSettlement({ entitlement, entries }),
		title: { kind: "trip", purpose: "Customer workshop", startDate: null, endDate: null },
		adjustments: [],
		adjustmentOf: null,
		adjustmentDelta: null,
	};
}

function build(recorded: SettlementAccount, newEntry: SettlementEntryView) {
	return buildSettlementNotification({
		account: recorded,
		entry: newEntry,
		idempotencyKey: "4c0b6f2e-1f5d-4a7e-9a55-0d0f3f0a9b10",
		recipientUserId: "employee-user",
	});
}

describe("buildSettlementNotification (#752)", () => {
	it("tells the employee their expense is reimbursed when nothing is left outstanding", () => {
		const paid = entry("reimbursement", "89.90");
		const notification = build(account([paid]), paid);

		expect(notification).toMatchObject({
			userId: "employee-user",
			organizationId: "org-1",
			type: "travel_expense_reimbursed",
			title: "Expense reimbursed",
			message:
				"Your travel expense has been fully reimbursed: 89.90 EUR, payment reference SEPA-4711.",
			entityType: "travel_expense_report",
			entityId: "report-1",
			actionUrl: "/travel-expenses/reports/report-1",
			idempotencyKey: "travel-expense-settlement:4c0b6f2e-1f5d-4a7e-9a55-0d0f3f0a9b10",
		});
		expect(notification.metadata?.i18n).toEqual({
			titleKey: "common:notifications.content.travelExpenseReimbursed.title",
			titleDefault: "Expense reimbursed",
			messageKey: "common:notifications.content.travelExpenseReimbursed.message",
			messageDefault:
				"Your travel expense has been fully reimbursed: {amount} {currency}, payment reference {reference}.",
			params: {
				amount: "89.90",
				currency: "EUR",
				reference: "SEPA-4711",
				remaining: "0.00",
				remainingCurrency: "EUR",
			},
		});
	});

	it("says how much is still awaiting reimbursement after a partial reimbursement", () => {
		const paid = entry("reimbursement", "50.00");
		const notification = build(account([paid]), paid);

		expect(notification.type).toBe("travel_expense_partially_reimbursed");
		expect(notification.title).toBe("Expense partially reimbursed");
		expect(notification.message).toBe(
			"50.00 EUR of your travel expense has been reimbursed (payment reference SEPA-4711). 39.90 EUR is still awaiting reimbursement.",
		);
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.travelExpensePartiallyReimbursed.message",
			params: {
				amount: "50.00",
				currency: "EUR",
				reference: "SEPA-4711",
				remaining: "39.90",
				remainingCurrency: "EUR",
			},
		});
	});

	it("is only fully reimbursed when no currency of the account is still outstanding", () => {
		const paid = entry("reimbursement", "89.90");
		const notification = build(
			account([paid], { adjustment: { currency: "CHF", amount: "12.50" } }),
			paid,
		);

		expect(notification.type).toBe("travel_expense_partially_reimbursed");
		expect(notification.message).toBe(
			"89.90 EUR of your travel expense has been reimbursed (payment reference SEPA-4711). 12.50 CHF is still awaiting reimbursement.",
		);
	});

	it("reports a recorded recovery, linking a legacy claim to its own page", () => {
		const paid = entry("reimbursement", "42.00");
		const recovered = entry("recovery", "10.00", { reference: "Payroll deduction" });
		const notification = build(
			account([paid, recovered], {
				source: { type: "legacy_claim", id: "claim-1" },
				entitlement: "32.00",
			}),
			recovered,
		);

		expect(notification).toMatchObject({
			type: "travel_expense_recovery_recorded",
			title: "Expense recovery recorded",
			message:
				"A recovery of 10.00 EUR was recorded for your travel expense (payment reference Payroll deduction).",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses/claim-1",
		});
	});

	it("names the payroll run instead of a payment reference when a confirmed run paid it (#853)", () => {
		const paid = entry("reimbursement", "89.90", {
			reference: "Payroll run 2026-10-01 – 2026-10-31",
			payrollRun: { id: "run-1", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
		});
		const notification = build(account([paid]), paid);

		expect(notification).toMatchObject({
			type: "travel_expense_reimbursed",
			title: "Expense reimbursed",
			message: "Your travel expense has been fully reimbursed with payroll 2026-10: 89.90 EUR.",
		});
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.travelExpenseReimbursedWithPayroll.message",
			messageDefault:
				"Your travel expense has been fully reimbursed with payroll {period}: {amount} {currency}.",
			params: { amount: "89.90", currency: "EUR", period: "2026-10" },
		});
	});

	it("names the payroll run's dates and what is left after a partial payroll payment (#853)", () => {
		const paid = entry("reimbursement", "50.00", {
			payrollRun: { id: "run-1", periodStart: "2026-10-01", periodEnd: "2026-10-15" },
		});
		const notification = build(account([paid]), paid);

		expect(notification.type).toBe("travel_expense_partially_reimbursed");
		expect(notification.message).toBe(
			"50.00 EUR of your travel expense has been reimbursed with payroll 2026-10-01 – 2026-10-15. 39.90 EUR is still awaiting reimbursement.",
		);
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey:
				"common:notifications.content.travelExpensePartiallyReimbursedWithPayroll.message",
		});
	});

	it("never reveals who recorded the money", () => {
		const paid = entry("reimbursement", "89.90");
		const serialized = JSON.stringify(build(account([paid]), paid));

		expect(serialized).not.toContain("finance-user");
		expect(serialized).not.toContain("Fiona Finance");
		expect(serialized).not.toContain("Paid with the October run");
	});
});
