import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

const { createNotification } = vi.hoisted(() => ({
	createNotification: vi.fn(),
}));

vi.mock("./notification-service", () => ({
	createNotification,
}));

import {
	onAbsenceRecordedByManager,
	onAbsenceRequestPendingApproval,
	onAbsenceRequestSubmitted,
	onApprovedAbsenceCancelledByEmployee,
	onBirthdayReminder,
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
	onClockOutRejected,
	onManualEntryApproved,
	onManualEntryRejected,
	onOpenShiftAvailable,
	onSchedulePublished,
	onShiftAssigned,
	onShiftPickupApproved,
	onShiftSwapApproved,
	onShiftSwapRejected,
	onShiftSwapRequestedToManager,
	onShiftSwapRequestedToTarget,
	onTimeCorrectionPendingApproval,
	onTravelExpenseApproved,
	onTravelExpenseRejected,
	onTravelExpenseReportDecided,
	onTravelExpenseReportReturned,
	onTwoFactorDisabled,
	onTwoFactorEnabled,
	onVacationBalanceAlert,
} from "./triggers";

describe("approval notification triggers", () => {
	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification-1" });
	});

	it("includes request details for the employee confirmation template", async () => {
		await onAbsenceRequestSubmitted({
			absenceId: "absence-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-12-28",
			endDate: "2026-12-31",
			managerName: "Morgan Manager",
			days: 4,
		});

		expect(createNotification).toHaveBeenCalledOnce();
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-requester",
				organizationId: "org-1",
				type: "absence_request_submitted",
				metadata: expect.objectContaining({
					startDate: "2026-12-28",
					endDate: "2026-12-31",
					absenceType: "Vacation",
					managerName: "Morgan Manager",
					days: 4,
					i18n: expect.objectContaining({
						params: { categoryName: "Vacation", dateRange: "Dec 28 - Dec 31" },
					}),
				}),
			}),
		);
	});
	it("links manager absence approval notifications to the unified inbox", async () => {
		await onAbsenceRequestPendingApproval({
			absenceId: "absence-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-11",
			endDate: "2026-05-12",
			managerUserId: "user-manager",
			managerName: "Morgan Manager",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "absence_entry",
				entityId: "absence-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("notifies employees when a manager records an absence on their behalf", async () => {
		await onAbsenceRecordedByManager({
			absenceId: "absence-1",
			employeeUserId: "user-employee",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Sick Leave",
			startDate: "2026-05-11",
			endDate: "2026-05-12",
			days: 2,
			managerName: "Morgan Manager",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-employee",
			organizationId: "org-1",
			type: "absence_request_approved",
			title: "Absence recorded",
			message:
				"Morgan Manager recorded Sick Leave for May 11 - May 12 on your behalf.",
			entityType: "absence_entry",
			entityId: "absence-1",
			actionUrl: "/absences",
			metadata: {
				managerRecorded: true,
				managerName: "Morgan Manager",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
				absenceType: "Sick Leave",
				days: 2,
			},
		});
	});

	it("swallows manager-recorded absence notification failures", async () => {
		createNotification.mockRejectedValueOnce(new Error("notification failed"));

		await expect(
			onAbsenceRecordedByManager({
				absenceId: "absence-1",
				employeeUserId: "user-employee",
				employeeName: "Avery Employee",
				organizationId: "org-1",
				categoryName: "Sick Leave",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
				days: 2,
				managerName: "Morgan Manager",
			}),
		).resolves.toBeUndefined();
	});

	it("notifies a manager when an employee cancels an approved absence", async () => {
		await onApprovedAbsenceCancelledByEmployee({
			absenceId: "absence-1",
			managerUserId: "user-manager",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-21",
			endDate: "2026-05-22",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-manager",
			organizationId: "org-1",
			type: "absence_request_approved",
			title: "Approved absence cancelled",
			message:
				"Avery Employee cancelled approved Vacation for May 21 - May 22.",
			entityType: "absence_entry",
			entityId: "absence-1",
			actionUrl: "/team/absences",
			metadata: {
				approvedAbsenceCancelled: true,
				employeeName: "Avery Employee",
				startDate: "2026-05-21",
				endDate: "2026-05-22",
				absenceType: "Vacation",
			},
		});
	});

	it("swallows approved absence cancellation notification failures", async () => {
		createNotification.mockRejectedValueOnce(new Error("notification failed"));

		await expect(
			onApprovedAbsenceCancelledByEmployee({
				absenceId: "absence-1",
				managerUserId: "user-manager",
				employeeName: "Avery Employee",
				organizationId: "org-1",
				categoryName: "Vacation",
				startDate: "2026-05-21",
				endDate: "2026-05-22",
			}),
		).resolves.toBeUndefined();
	});

	it("links manager time-correction approval notifications to the unified inbox", async () => {
		await onTimeCorrectionPendingApproval({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			originalTime: new Date("2026-05-11T08:00:00.000Z"),
			correctedTime: new Date("2026-05-11T08:15:00.000Z"),
			managerUserId: "user-manager",
			reason: "Forgot to clock in",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "work_period",
				entityId: "period-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("links manager clock-out approval notifications to the unified inbox", async () => {
		await onClockOutPendingApprovalToManager({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
			durationMinutes: 480,
			managerUserId: "user-manager",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "work_period",
				entityId: "period-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("reports durable clock-out notification persistence failures", async () => {
		const failure = new Error("notification failed");
		createNotification.mockRejectedValueOnce(failure);

		await expect(
			onClockOutPendingApproval({
				workPeriodId: "period-1",
				employeeUserId: "user-requester",
				employeeName: "Avery Requester",
				organizationId: "org-1",
				startTime: new Date("2026-05-11T08:00:00.000Z"),
				endTime: new Date("2026-05-11T16:00:00.000Z"),
				durationMinutes: 480,
				idempotencyKey: "submission:pending:employee",
				durable: true,
			}),
		).rejects.toBe(failure);
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "submission:pending:employee",
			}),
			{ throwOnError: true },
		);
	});

	it("notifies an employee that a manual time submission was approved", async () => {
		await onManualEntryApproved({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-requester",
				title: "Manual time submission approved",
				message: "Your manual time submission was approved by Morgan Manager.",
				entityId: "period-1",
			}),
		);
	});

	it("notifies an employee that a manual time submission was rejected", async () => {
		await onManualEntryRejected({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
			rejectionReason: "Overlaps another record",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Manual time submission rejected",
				message:
					"Your manual time submission was rejected by Morgan Manager. Reason: Overlaps another record",
			}),
		);
	});

	it("describes rejected clock-out approval state without claiming time reversion", async () => {
		await onClockOutRejected({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
			rejectionReason: "Outside policy",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Clock-out rejected",
				message:
					"Your clock-out approval was rejected by Morgan Manager. Reason: Outside policy The recorded times remain unchanged and are excluded from approved payroll time.",
			}),
		);
	});

	it("links manager shift-swap approval notifications to the unified inbox", async () => {
		await onShiftSwapRequestedToManager({
			requestId: "shift-request-1",
			organizationId: "org-1",
			managerUserId: "user-manager",
			requesterName: "Avery Requester",
			shiftDate: parsePlainDate("2026-05-11"),
			startTime: "08:00",
			endTime: "16:00",
			targetEmployeeName: "Taylor Target",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "shift_swap_requested",
				entityType: "shift_request",
				entityId: "shift-request-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	describe("shift dates", () => {
		// A Berlin shift on Friday 2026-10-09, stored at 2026-10-08T22:00Z.
		const shiftDate = parsePlainDate("2026-10-09");
		const shift = {
			shiftId: "shift-1",
			organizationId: "org-1",
			startTime: "08:00",
			endTime: "16:00",
		};
		const swap = { ...shift, requestId: "request-1", requesterName: "Avery Requester" };
		const decision = { ...swap, requesterUserId: "user-requester", approverName: "Morgan Manager" };

		it.each([
			[
				"shift assigned",
				() =>
					onShiftAssigned({
						...shift,
						employeeUserId: "user-1",
						shiftDate,
						assignedByName: "Morgan",
					}),
			],
			[
				"swap requested to the manager",
				() => onShiftSwapRequestedToManager({ ...swap, managerUserId: "user-manager", shiftDate }),
			],
			[
				"swap requested to the target",
				() => onShiftSwapRequestedToTarget({ ...swap, targetEmployeeUserId: "user-2", shiftDate }),
			],
			["swap approved", () => onShiftSwapApproved({ ...decision, shiftDate })],
			["swap rejected", () => onShiftSwapRejected({ ...decision, shiftDate })],
			[
				"open shift available",
				() => onOpenShiftAvailable({ ...shift, teamMemberUserIds: ["user-1"], shiftDate }),
			],
			[
				"pickup approved",
				() =>
					onShiftPickupApproved({
						...shift,
						employeeUserId: "user-1",
						approverName: "Morgan",
						shiftDate,
					}),
			],
		])("announces the %s notification on the shift's calendar date", async (_name, trigger) => {
			await trigger();

			const notification = lastNotification();
			expect(notification.message).toContain("Fri, Oct 9");
			expect(notification.message).not.toContain("{");
			// Each channel formats the calendar date in the recipient's language.
			expect(i18nOf(notification)).toMatchObject({
				titleKey: expect.stringMatching(/^common:notifications\.content\.\w+\.title$/),
				messageKey: expect.stringMatching(/^common:notifications\.content\.\w+\.message\w*$/),
				params: expect.objectContaining({
					shiftDate: { kind: "plainDate", date: "2026-10-09", preset: "weekdayMonthDay" },
				}),
			});
		});

		it.each([
			[undefined, "shiftSwapRequestedToManager.message"],
			["Taylor Target", "shiftSwapRequestedToManager.messageWithTarget"],
		])("picks the manager swap copy for target %s", async (targetEmployeeName, key) => {
			await onShiftSwapRequestedToManager({
				...swap,
				managerUserId: "user-manager",
				shiftDate,
				targetEmployeeName,
			});

			expect(i18nOf(lastNotification()).messageKey).toBe(`common:notifications.content.${key}`);
		});

		it("adds the rejection reason to a rejected swap", async () => {
			await onShiftSwapRejected({ ...decision, shiftDate, rejectionReason: "Understaffed" });

			const notification = lastNotification();
			expect(notification.message).toBe(
				"Your shift swap request for Fri, Oct 9 was rejected by Morgan Manager. Reason: Understaffed",
			);
			expect(i18nOf(notification)).toMatchObject({
				messageKey: "common:notifications.content.shiftSwapRejected.messageWithReason",
				params: expect.objectContaining({ reason: "Understaffed" }),
			});
		});
	});

	it("creates a requester notification for approved travel expenses", async () => {
		await onTravelExpenseApproved({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			destinationCity: "Berlin",
			amount: "120.50",
			currency: "EUR",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-requester",
			organizationId: "org-1",
			type: "approval_request_approved",
			title: "Travel expense approved",
			message: "Your travel expense claim for Berlin (€120.50) was approved by Morgan Manager.",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.travelExpenseApproved.title",
					titleDefault: "Travel expense approved",
					messageKey: "common:notifications.content.travelExpenseApproved.message",
					messageDefault:
						"Your travel expense claim for {destination} ({amount}) was approved by {approverName}.",
					params: {
						destination: "Berlin",
						amount: { kind: "money", amount: "120.50", currency: "EUR" },
						approverName: "Morgan Manager",
					},
				},
			},
		});
	});

	it("creates a requester notification for rejected travel expenses", async () => {
		await onTravelExpenseRejected({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			destinationCity: null,
			amount: "120.50",
			currency: "EUR",
			rejectionReason: "Missing receipt",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-requester",
			organizationId: "org-1",
			type: "approval_request_rejected",
			title: "Travel expense rejected",
			message:
				"Your travel expense claim for €120.50 was rejected by Morgan Manager. Reason: Missing receipt",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses",
			metadata: {
				i18n: expect.objectContaining({
					titleKey: "common:notifications.content.travelExpenseRejected.title",
					messageKey:
						"common:notifications.content.travelExpenseRejected.messageWithoutDestinationWithReason",
					params: {
						amount: { kind: "money", amount: "120.50", currency: "EUR" },
						approverName: "Morgan Manager",
						reason: "Missing receipt",
					},
				}),
			},
		});
	});

	it.each([
		[undefined, "Berlin", "travelExpenseRejected.message"],
		["Missing receipt", "Berlin", "travelExpenseRejected.messageWithReason"],
		[undefined, null, "travelExpenseRejected.messageWithoutDestination"],
	])("picks the rejection copy for reason %s and destination %s", async (reason, city, key) => {
		await onTravelExpenseRejected({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			destinationCity: city,
			amount: "120.50",
			currency: "EUR",
			rejectionReason: reason,
		});

		expect(i18nOf(lastNotification()).messageKey).toBe(`common:notifications.content.${key}`);
		expect(lastNotification().message).not.toContain("{");
	});

	it.each([
		[
			"approve" as const,
			undefined,
			"approval_request_approved",
			"Expense report approved",
			"travelExpenseReportApproved.message",
			"Your expense report (reimbursable €80.00) was approved by Morgan Manager.",
		],
		[
			"reject" as const,
			undefined,
			"approval_request_rejected",
			"Expense report rejected",
			"travelExpenseReportRejected.message",
			"Your expense report (reimbursable €80.00) was rejected by Morgan Manager.",
		],
		[
			"reject" as const,
			"Duplicate hotel",
			"approval_request_rejected",
			"Expense report rejected",
			"travelExpenseReportRejected.messageWithReason",
			"Your expense report (reimbursable €80.00) was rejected by Morgan Manager. Reason: Duplicate hotel",
		],
	])(
		"translates the %s expense report decision (reason %s)",
		async (action, reason, type, title, key, message) => {
			await onTravelExpenseReportDecided({
				reportId: "report-1",
				requesterUserId: "user-requester",
				organizationId: "org-1",
				approverName: "Morgan Manager",
				action,
				reimbursable: "80.00",
				currency: "EUR",
				rejectionReason: reason,
			});

			const notification = lastNotification();
			expect(notification).toMatchObject({ type, title, message });
			expect(i18nOf(notification)).toMatchObject({
				messageKey: `common:notifications.content.${key}`,
				params: expect.objectContaining({
					amount: { kind: "money", amount: "80.00", currency: "EUR" },
				}),
			});
		},
	);

	it("translates a returned expense report", async () => {
		await onTravelExpenseReportReturned({
			reportId: "report-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			reviewerName: "Morgan Manager",
			note: "Add the taxi receipt",
		});

		const notification = lastNotification();
		expect(notification).toMatchObject({
			title: "Expense report returned for changes",
			message: "Morgan Manager returned your expense report for changes: Add the taxi receipt",
		});
		expect(i18nOf(notification)).toMatchObject({
			titleKey: "common:notifications.content.travelExpenseReportReturned.title",
			messageKey: "common:notifications.content.travelExpenseReportReturned.message",
			params: { reviewerName: "Morgan Manager", note: "Add the taxi receipt" },
		});
	});
});

describe("security notification triggers", () => {
	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification-1" });
	});

	it.each([
		[
			onTwoFactorEnabled,
			"twoFactorEnabled",
			"Two-factor authentication enabled",
			"Two-factor authentication has been enabled on your account for added security.",
		],
		[
			onTwoFactorDisabled,
			"twoFactorDisabled",
			"Two-factor authentication disabled",
			"Two-factor authentication has been disabled on your account. We recommend re-enabling it for security.",
		],
	])("translates the two-factor notice (%#)", async (trigger, key, title, message) => {
		await trigger({ userId: "user-1", organizationId: "org-1" });

		const notification = lastNotification();
		expect(notification).toMatchObject({ title, message });
		expect(i18nOf(notification)).toMatchObject({
			titleKey: `common:notifications.content.${key}.title`,
			titleDefault: title,
			messageKey: `common:notifications.content.${key}.message`,
			messageDefault: message,
		});
	});
});

describe("reminder notification triggers", () => {
	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification-1" });
	});

	it("names the birthday as a calendar day, whatever the server zone", async () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		try {
			await onBirthdayReminder({
				userId: "user-1",
				organizationId: "org-1",
				birthdayPersonName: "Ada",
				birthdayDate: parsePlainDate("2026-10-09"),
			});
		} finally {
			vi.unstubAllEnvs();
		}

		const notification = lastNotification();
		expect(notification.message).toBe("Ada's birthday is on October 9.");
		expect(i18nOf(notification)).toMatchObject({
			titleKey: "common:notifications.content.birthdayReminder.title",
			messageKey: "common:notifications.content.birthdayReminder.message",
			params: {
				name: "Ada",
				date: { kind: "plainDate", date: "2026-10-09", preset: "monthDayLong" },
			},
		});
	});

	it.each([
		[1, undefined, "vacationBalanceAlert.message", "You have 1 vacation day remaining."],
		[
			3,
			"2026-12-31",
			"vacationBalanceAlert.expiringMessage",
			"You have 3 vacation days expiring on Dec 31. Use them before they expire!",
		],
	])(
		"translates the vacation balance alert for %s days (expiry %s)",
		async (remainingDays, expiry, key, messageStart) => {
			await onVacationBalanceAlert({
				userId: "user-1",
				organizationId: "org-1",
				remainingDays,
				expiryDate: expiry ? parsePlainDate(expiry) : undefined,
			});

			const notification = lastNotification();
			expect(notification.message.startsWith(messageStart)).toBe(true);
			const i18n = i18nOf(notification);
			expect(i18n.messageKey).toBe(`common:notifications.content.${key}`);
			expect(i18n.messageDefault).toContain("{remainingDays, plural,");
			expect(i18n.params).toMatchObject({ remainingDays });
			if (expiry) {
				expect(i18n.params).toMatchObject({
					expiryDate: { kind: "plainDate", date: expiry, preset: "monthDay" },
				});
			}
		},
	);

	it("translates a published schedule with its plain date range", async () => {
		await onSchedulePublished({
			employeeUserId: "user-1",
			employeeName: "Ada",
			organizationId: "org-1",
			shiftCount: 2,
			dateRange: { start: parsePlainDate("2026-10-12"), end: parsePlainDate("2026-10-18") },
		});

		const notification = lastNotification();
		// Intl puts thin spaces around the range dash.
		expect(notification.message).toMatch(/^2 shifts have been published for Oct 12\s–\s18, 2026\.$/);
		expect(i18nOf(notification)).toMatchObject({
			titleKey: "common:notifications.content.schedulePublished.title",
			messageKey: "common:notifications.content.schedulePublished.message",
			params: {
				shiftCount: 2,
				dateRange: { kind: "plainDateRange", start: "2026-10-12", end: "2026-10-18" },
			},
		});
	});
});

function lastNotification(): {
	title: string;
	message: string;
	metadata: { i18n: Record<string, unknown> & { params?: Record<string, unknown> } };
} {
	const call = createNotification.mock.calls.at(-1);
	if (!call) throw new Error("No notification was created");
	return call[0];
}

function i18nOf(notification: ReturnType<typeof lastNotification>) {
	return notification.metadata.i18n;
}
