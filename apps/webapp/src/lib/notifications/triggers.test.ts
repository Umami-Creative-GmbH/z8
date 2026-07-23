import { beforeEach, describe, expect, it, vi } from "vitest";

const { createNotification } = vi.hoisted(() => ({
	createNotification: vi.fn(),
}));

vi.mock("./notification-service", () => ({
	createNotification,
}));

import {
	onAbsenceRecordedByManager,
	onAbsenceRequestPendingApproval,
	onApprovedAbsenceCancelledByEmployee,
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
	onClockOutRejected,
	onManualEntryApproved,
	onManualEntryRejected,
	onShiftSwapRequestedToManager,
	onTimeCorrectionPendingApproval,
	onTravelExpenseApproved,
	onTravelExpenseRejected,
} from "./triggers";

describe("approval notification triggers", () => {
	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification-1" });
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
			shiftDate: new Date("2026-05-11T00:00:00.000Z"),
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
			message:
				"Your travel expense claim for Berlin (EUR 120.50) was approved by Morgan Manager.",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses",
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
				"Your travel expense claim for EUR 120.50 was rejected by Morgan Manager. Reason: Missing receipt",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses",
		});
	});
});
