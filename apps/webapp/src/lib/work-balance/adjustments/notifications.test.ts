import { describe, expect, it } from "vitest";
import { buildBalanceAdjustmentNotification } from "./notifications";

const payout = {
	id: "99600000-0000-4000-8000-000000000001",
	kind: "overtime_payout" as const,
	day: "2026-10-08",
	minutes: -300,
};

describe("buildBalanceAdjustmentNotification", () => {
	it("tells the employee a payout was recorded, naming its kind, day and time", () => {
		const params = buildBalanceAdjustmentNotification({
			organizationId: "org-1",
			recipientUserId: "user-employee",
			event: "recorded",
			adjustment: payout,
			locale: "en-GB",
		});

		expect(params).toMatchObject({
			userId: "user-employee",
			organizationId: "org-1",
			type: "work_balance_adjustment_recorded",
			title: "Overtime payout recorded",
			message: "An overtime payout of 5:00h for 8 Oct 2026 was recorded on your work balance.",
			entityType: "balance_adjustment",
			entityId: payout.id,
			actionUrl: "/time-tracking",
			idempotencyKey: `balance-adjustment:${payout.id}:recorded:user-employee`,
		});
		expect(params.metadata).toEqual({
			kind: "overtime_payout",
			day: "2026-10-08",
			minutes: -300,
			// The in-app reader formats the day in their own locale.
			dateRangeDays: { startDate: "2026-10-08", endDate: "2026-10-08" },
			i18n: {
				titleKey: "common:notifications.content.balanceAdjustment.payoutRecorded.title",
				titleDefault: "Overtime payout recorded",
				messageKey: "common:notifications.content.balanceAdjustment.payoutRecorded.message",
				messageDefault:
					"An overtime payout of {amount} for {dateRange} was recorded on your work balance.",
				params: { amount: "5:00h", dateRange: "8 Oct 2026" },
			},
		});
	});

	it("sends a cancellation as its own notification, once, with the cancellation reason", () => {
		const params = buildBalanceAdjustmentNotification({
			organizationId: "org-1",
			recipientUserId: "user-employee",
			event: "cancelled",
			adjustment: { ...payout, cancellationReason: "Recorded for the wrong month" },
			locale: "en-GB",
		});

		expect(params).toMatchObject({
			type: "work_balance_adjustment_cancelled",
			title: "Overtime payout cancelled",
			message:
				"The overtime payout of 5:00h for 8 Oct 2026 was cancelled. Reason: Recorded for the wrong month",
			idempotencyKey: `balance-adjustment:${payout.id}:cancelled:user-employee`,
		});
		expect(params.metadata).toMatchObject({
			i18n: {
				messageKey: "common:notifications.content.balanceAdjustment.payoutCancelled.message",
				messageDefault:
					"The overtime payout of {amount} for {dateRange} was cancelled. Reason: {reason}",
				params: {
					amount: "5:00h",
					dateRange: "8 Oct 2026",
					reason: "Recorded for the wrong month",
				},
			},
		});
	});

	it("shows an opening balance with its sign, which may be negative", () => {
		const recorded = buildBalanceAdjustmentNotification({
			organizationId: "org-1",
			recipientUserId: "user-employee",
			event: "recorded",
			adjustment: { ...payout, kind: "opening_balance", minutes: -90 },
			locale: "en-GB",
		});
		expect(recorded).toMatchObject({
			title: "Opening balance recorded",
			message: "An opening balance of -1:30h for 8 Oct 2026 was recorded on your work balance.",
		});

		const cancelled = buildBalanceAdjustmentNotification({
			organizationId: "org-1",
			recipientUserId: "user-employee",
			event: "cancelled",
			adjustment: {
				...payout,
				kind: "opening_balance",
				minutes: 750,
				cancellationReason: "Wrong employee",
			},
			locale: "de",
		});
		expect(cancelled).toMatchObject({
			title: "Opening balance cancelled",
			message:
				"The opening balance of +12:30h for 8. Okt. 2026 was cancelled. Reason: Wrong employee",
		});
	});
});
