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
	onClockOutPendingApprovalToManager,
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
			managerName: "Morgan Manager",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-employee",
			organizationId: "org-1",
			type: "absence_request_approved",
			title: "Absence recorded",
			message: "Morgan Manager recorded Sick Leave for May 11 - May 12 on your behalf.",
			entityType: "absence_entry",
			entityId: "absence-1",
			actionUrl: "/absences",
			metadata: {
				managerRecorded: true,
				managerName: "Morgan Manager",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
				absenceType: "Sick Leave",
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
				managerName: "Morgan Manager",
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
			message: "Your travel expense claim for Berlin (EUR 120.50) was approved by Morgan Manager.",
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
