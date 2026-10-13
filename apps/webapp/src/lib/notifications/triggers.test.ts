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
	onAbsenceRequestApproved,
	onAbsenceRequestPendingApproval,
	onAbsenceRequestRejected,
	onAbsenceRequestSubmitted,
	onApprovedAbsenceCancelledByEmployee,
	onBirthdayReminder,
	onClockOutApproved,
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
	onTimeCorrectionApproved,
	onTimeCorrectionPendingApproval,
	onTimeCorrectionRejected,
	onTimeCorrectionSubmitted,
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
				// Intl puts thin spaces around the range dash.
				message: expect.stringMatching(
					/^Your Vacation request for Dec 28\s–\s31, 2026 has been submitted and is pending approval\.$/,
				),
				metadata: {
					absenceType: "Vacation",
					managerName: "Morgan Manager",
					days: 4,
					i18n: {
						titleKey: "common:notifications.content.absenceRequestSubmitted.title",
						titleDefault: "Absence request submitted",
						messageKey: "common:notifications.content.absenceRequestSubmitted.message",
						messageDefault:
							"Your {categoryName} request for {dateRange} has been submitted and is pending approval.",
						// Calendar days, formatted per recipient: no en-US text is stored as a param.
						params: {
							categoryName: "Vacation",
							startDate: { kind: "plainDate", date: "2026-12-28" },
							endDate: { kind: "plainDate", date: "2026-12-31" },
							dateRange: { kind: "plainDateRange", start: "2026-12-28", end: "2026-12-31" },
						},
					},
				},
			}),
		);
	});

	describe("absence copy", () => {
		const absence = {
			absenceId: "absence-1",
			employeeUserId: "user-employee",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-11",
			endDate: "2026-05-12",
		};
		const dateRange = { kind: "plainDateRange", start: "2026-05-11", end: "2026-05-12" };

		it.each([
			[
				"pending approval",
				() =>
					onAbsenceRequestPendingApproval({
						...absence,
						managerUserId: "user-manager",
						managerName: "Morgan Manager",
					}),
				"newAbsenceRequest",
				"message",
				"New absence request",
				"Avery Employee requested Vacation for May 11 – 12, 2026.",
			],
			[
				"approved",
				() => onAbsenceRequestApproved({ ...absence, approverName: "Morgan Manager" }),
				"absenceRequestApproved",
				"message",
				"Absence request approved",
				"Your Vacation request for May 11 – 12, 2026 was approved by Morgan Manager.",
			],
			[
				"rejected",
				() => onAbsenceRequestRejected({ ...absence, approverName: "Morgan Manager" }),
				"absenceRequestRejected",
				"message",
				"Absence request rejected",
				"Your Vacation request for May 11 – 12, 2026 was rejected by Morgan Manager.",
			],
			[
				"rejected with a reason",
				() =>
					onAbsenceRequestRejected({
						...absence,
						approverName: "Morgan Manager",
						rejectionReason: "Team offsite",
					}),
				"absenceRequestRejected",
				"messageWithReason",
				"Absence request rejected",
				"Your Vacation request for May 11 – 12, 2026 was rejected by Morgan Manager. Reason: Team offsite",
			],
			[
				"recorded by a manager",
				() => onAbsenceRecordedByManager({ ...absence, managerName: "Morgan Manager", days: 2 }),
				"absenceRecorded",
				"message",
				"Absence recorded",
				"Morgan Manager recorded Vacation for May 11 – 12, 2026 on your behalf.",
			],
			[
				"approved absence cancelled",
				() => onApprovedAbsenceCancelledByEmployee({ ...absence, managerUserId: "user-manager" }),
				"approvedAbsenceCancelled",
				"message",
				"Approved absence cancelled",
				"Avery Employee cancelled approved Vacation for May 11 – 12, 2026.",
			],
		])(
			"translates the %s notification with its calendar dates",
			async (_name, trigger, copy, messageVariant, title, message) => {
				await trigger();

				const notification = lastNotification();
				expect(notification.title).toBe(title);
				expect(notification.message.replace(/\s–\s/, " – ")).toBe(message);
				expect(i18nOf(notification)).toMatchObject({
					titleKey: `common:notifications.content.${copy}.title`,
					titleDefault: title,
					messageKey: `common:notifications.content.${copy}.${messageVariant}`,
					params: expect.objectContaining({ dateRange }),
				});
			},
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

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-employee",
				organizationId: "org-1",
				type: "absence_request_approved",
				title: "Absence recorded",
				entityType: "absence_entry",
				entityId: "absence-1",
				actionUrl: "/absences",
				metadata: expect.objectContaining({
					managerRecorded: true,
					managerName: "Morgan Manager",
					absenceType: "Sick Leave",
					days: 2,
					i18n: expect.objectContaining({
						params: {
							managerName: "Morgan Manager",
							absenceType: "Sick Leave",
							startDate: { kind: "plainDate", date: "2026-05-11" },
							endDate: { kind: "plainDate", date: "2026-05-12" },
							dateRange: { kind: "plainDateRange", start: "2026-05-11", end: "2026-05-12" },
							days: 2,
						},
					}),
				}),
			}),
		);
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

		// #1136 (its own notification type) has not landed: the type stays as it is.
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "absence_request_approved",
				title: "Approved absence cancelled",
				entityType: "absence_entry",
				entityId: "absence-1",
				actionUrl: "/team/absences",
				metadata: expect.objectContaining({
					approvedAbsenceCancelled: true,
					employeeName: "Avery Employee",
					absenceType: "Vacation",
					i18n: expect.objectContaining({
						params: {
							employeeName: "Avery Employee",
							categoryName: "Vacation",
							startDate: { kind: "plainDate", date: "2026-05-21" },
							endDate: { kind: "plainDate", date: "2026-05-22" },
							dateRange: { kind: "plainDateRange", start: "2026-05-21", end: "2026-05-22" },
						},
					}),
				}),
			}),
		);
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

	it("carries the absence details the manager's pending email needs, as calendar dates (#1152)", async () => {
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
			days: 2,
			notes: "Family trip",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: {
					approvalSubject: "absence",
					i18n: expect.objectContaining({
						params: {
							employeeName: "Avery Requester",
							categoryName: "Vacation",
							startDate: { kind: "plainDate", date: "2026-05-11" },
							endDate: { kind: "plainDate", date: "2026-05-12" },
							dateRange: { kind: "plainDateRange", start: "2026-05-11", end: "2026-05-12" },
							days: 2,
							notes: "Family trip",
						},
					}),
				},
			}),
		);
	});

	it("carries the approver and calendar dates of an absence decision (#1152)", async () => {
		const decision = {
			absenceId: "absence-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-11",
			endDate: "2026-05-12",
			approverName: "Morgan Manager",
			days: 2,
		};
		await onAbsenceRequestApproved(decision);
		await onAbsenceRequestRejected({ ...decision, rejectionReason: "Team offsite" });

		const params = {
			approverName: "Morgan Manager",
			categoryName: "Vacation",
			startDate: { kind: "plainDate", date: "2026-05-11" },
			endDate: { kind: "plainDate", date: "2026-05-12" },
			dateRange: { kind: "plainDateRange", start: "2026-05-11", end: "2026-05-12" },
			days: 2,
		};
		expect(
			createNotification.mock.calls.map(([notification]) => notification.metadata.i18n.params),
		).toEqual([params, { ...params, rejectionReason: "Team offsite" }]);
	});

	it("links manager time-correction approval notifications to the unified inbox, with entry-offset times (#1152)", async () => {
		await onTimeCorrectionPendingApproval({
			workPeriodId: "period-1",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			managerUserId: "user-manager",
			reason: "Forgot to clock in",
			original: {
				clockIn: { at: new Date("2026-05-11T08:00:00.000Z"), utcOffsetMinutes: 120 },
				clockOut: null,
			},
			corrected: {
				clockIn: { at: new Date("2026-05-11T07:15:00.000Z"), utcOffsetMinutes: 120 },
				clockOut: { at: new Date("2026-05-11T15:00:00.000Z"), utcOffsetMinutes: -240 },
			},
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "work_period",
				entityId: "period-1",
				actionUrl: "/approvals/inbox",
				metadata: {
					approvalSubject: "time_correction",
					i18n: expect.objectContaining({
						params: {
							employeeName: "Avery Requester",
							reason: "Forgot to clock in",
							date: {
								kind: "entryInstant",
								at: "2026-05-11T08:00:00Z",
								utcOffsetMinutes: 120,
								preset: "dateMedium",
							},
							originalClockIn: {
								kind: "entryInstant",
								at: "2026-05-11T08:00:00Z",
								utcOffsetMinutes: 120,
								preset: "time",
							},
							correctedClockIn: {
								kind: "entryInstant",
								at: "2026-05-11T07:15:00Z",
								utcOffsetMinutes: 120,
								preset: "time",
							},
							correctedClockOut: {
								kind: "entryInstant",
								at: "2026-05-11T15:00:00Z",
								utcOffsetMinutes: -240,
								preset: "time",
							},
						},
					}),
				},
			}),
		);
	});

	it("carries the corrected times of a time-correction decision at their entries' offsets (#1137)", async () => {
		const decision = {
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			originalTime: new Date("2026-05-11T08:00:00.000Z"),
			correctedTime: new Date("2026-05-11T07:15:00.000Z"),
			approverName: "Morgan Manager",
			corrected: {
				clockIn: { at: new Date("2026-05-11T07:15:00.000Z"), utcOffsetMinutes: 120 },
				clockOut: null,
			},
		};
		await onTimeCorrectionApproved(decision);
		await onTimeCorrectionRejected({ ...decision, rejectionReason: "Not plausible" });

		const params = {
			approverName: "Morgan Manager",
			date: {
				kind: "entryInstant",
				at: "2026-05-11T07:15:00Z",
				utcOffsetMinutes: 120,
				preset: "dateMedium",
			},
			correctedClockIn: {
				kind: "entryInstant",
				at: "2026-05-11T07:15:00Z",
				utcOffsetMinutes: 120,
				preset: "time",
			},
		};
		expect(
			createNotification.mock.calls.map(([notification]) => notification.metadata.i18n.params),
		).toEqual([params, { ...params, rejectionReason: "Not plausible" }]);
	});

	describe("time correction copy", () => {
		const period = {
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			originalTime: new Date("2026-05-11T08:00:00.000Z"),
			correctedTime: new Date("2026-05-11T07:15:00.000Z"),
		};
		const decision = {
			...period,
			approverName: "Morgan Manager",
			corrected: {
				clockIn: { at: new Date("2026-05-11T07:15:00.000Z"), utcOffsetMinutes: 120 },
				clockOut: null,
			},
		};
		const pending = {
			workPeriodId: "period-1",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			managerUserId: "user-manager",
			original: {
				clockIn: { at: new Date("2026-05-11T08:00:00.000Z"), utcOffsetMinutes: 120 },
				clockOut: null,
			},
			corrected: {
				clockIn: { at: new Date("2026-05-11T07:15:00.000Z"), utcOffsetMinutes: 120 },
				clockOut: null,
			},
		};

		it.each([
			[
				"submitted",
				() => onTimeCorrectionSubmitted(period),
				"timeCorrectionSubmitted.title",
				"timeCorrectionSubmitted.message",
				"Time correction submitted",
				"Your time correction request has been submitted and is pending approval.",
			],
			[
				"pending approval",
				() => onTimeCorrectionPendingApproval(pending),
				"newTimeCorrectionRequest.title",
				"newTimeCorrectionRequest.message",
				"New time correction request",
				"Avery Requester submitted a time correction request for May 11, 2026.",
			],
			[
				"pending approval with a reason",
				() => onTimeCorrectionPendingApproval({ ...pending, reason: "Forgot to clock in" }),
				"newTimeCorrectionRequest.title",
				"newTimeCorrectionRequest.messageWithReason",
				"New time correction request",
				"Avery Requester submitted a time correction request for May 11, 2026. Reason: Forgot to clock in",
			],
			[
				"pending approval without its times",
				() => onTimeCorrectionPendingApproval({ ...pending, original: null, corrected: null }),
				"newTimeCorrectionRequest.title",
				"newTimeCorrectionRequest.messageWithoutDate",
				"New time correction request",
				"Avery Requester submitted a time correction request.",
			],
			[
				"pending approval without its times, with a reason",
				() =>
					onTimeCorrectionPendingApproval({
						...pending,
						original: null,
						corrected: null,
						reason: "Forgot to clock in",
					}),
				"newTimeCorrectionRequest.title",
				"newTimeCorrectionRequest.messageWithoutDateWithReason",
				"New time correction request",
				"Avery Requester submitted a time correction request. Reason: Forgot to clock in",
			],
			[
				"approved",
				() => onTimeCorrectionApproved(decision),
				"timeCorrectionApproved.title",
				"timeCorrectionApproved.message",
				"Time correction approved",
				"Your time correction request was approved by Morgan Manager.",
			],
			[
				"rejected",
				() => onTimeCorrectionRejected(decision),
				"timeCorrectionRejected.title",
				"timeCorrectionRejected.message",
				"Time correction rejected",
				"Your time correction request was rejected by Morgan Manager.",
			],
			[
				"rejected with a reason",
				() => onTimeCorrectionRejected({ ...decision, rejectionReason: "Not plausible" }),
				"timeCorrectionRejected.title",
				"timeCorrectionRejected.messageWithReason",
				"Time correction rejected",
				"Your time correction request was rejected by Morgan Manager. Reason: Not plausible",
			],
		])(
			"translates the %s notification",
			async (_name, trigger, titleKey, messageKey, title, message) => {
				await trigger();

				const notification = lastNotification();
				expect(notification).toMatchObject({ title, message });
				expect(i18nOf(notification)).toMatchObject({
					titleKey: `common:notifications.content.${titleKey}`,
					titleDefault: title,
					messageKey: `common:notifications.content.${messageKey}`,
				});
			},
		);
	});

	describe("clocking copy", () => {
		// Clocked in at 22:30 local (UTC+2) on May 10, out at 06:45 the next morning.
		const times = {
			clockIn: { at: new Date("2026-05-10T20:30:00.000Z"), utcOffsetMinutes: 120 },
			clockOut: { at: new Date("2026-05-11T04:45:00.000Z"), utcOffsetMinutes: 120 },
		};
		const submission = {
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			durationMinutes: 495,
		};

		it("shows the manager the period's times at its entries' offset, whatever the server zone", async () => {
			vi.stubEnv("TZ", "Pacific/Honolulu");
			try {
				await onClockOutPendingApprovalToManager({
					...submission,
					times,
					managerUserId: "user-manager",
				});
			} finally {
				vi.unstubAllEnvs();
			}

			const notification = lastNotification();
			expect(notification.title).toBe("Clock-out approval required");
			expect(notification.message.replace(/\s/g, " ")).toBe(
				"Avery Requester clocked out on May 10, 2026 (10:30 PM – 6:45 AM, 8 hours 15 minutes). Approval required.",
			);
			expect(i18nOf(notification)).toMatchObject({
				titleKey: "common:notifications.content.clockOutApprovalRequired.title",
				messageKey: "common:notifications.content.clockOutApprovalRequired.message",
				params: {
					employeeName: "Avery Requester",
					date: {
						kind: "entryInstant",
						at: "2026-05-10T20:30:00Z",
						utcOffsetMinutes: 120,
						preset: "dateMedium",
					},
					startTime: {
						kind: "entryInstant",
						at: "2026-05-10T20:30:00Z",
						utcOffsetMinutes: 120,
						preset: "time",
					},
					endTime: {
						kind: "entryInstant",
						at: "2026-05-11T04:45:00Z",
						utcOffsetMinutes: 120,
						preset: "time",
					},
					duration: { kind: "duration", minutes: 495 },
				},
			});
		});

		it.each([
			[
				"employee pending, with times",
				() => onClockOutPendingApproval({ ...submission, times }),
				"clockOutPendingApproval",
				"message",
				"Clock-out pending approval",
				"Your clock-out on May 10, 2026 (8 hours 15 minutes) is pending manager approval.",
			],
			[
				"employee pending, without times",
				() => onClockOutPendingApproval({ ...submission, times: null }),
				"clockOutPendingApproval",
				"messageWithoutDate",
				"Clock-out pending approval",
				"Your clock-out (8 hours 15 minutes) is pending manager approval.",
			],
			[
				"manager pending, without times",
				() =>
					onClockOutPendingApprovalToManager({
						...submission,
						times: null,
						managerUserId: "user-manager",
					}),
				"clockOutApprovalRequired",
				"messageWithoutTimes",
				"Clock-out approval required",
				"Avery Requester clocked out (8 hours 15 minutes). Approval required.",
			],
		])("translates the %s notification", async (_name, trigger, copy, variant, title, message) => {
			await trigger();

			const notification = lastNotification();
			expect(notification).toMatchObject({ title, message });
			expect(i18nOf(notification)).toMatchObject({
				titleKey: `common:notifications.content.${copy}.title`,
				messageKey: `common:notifications.content.${copy}.${variant}`,
			});
		});

		const decision = {
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
		};

		it.each([
			[onClockOutApproved, undefined, "clockOutApproved", "message"],
			[onClockOutRejected, undefined, "clockOutRejected", "message"],
			[onClockOutRejected, "Outside policy", "clockOutRejected", "messageWithReason"],
			[onManualEntryApproved, undefined, "manualEntryApproved", "message"],
			[onManualEntryRejected, undefined, "manualEntryRejected", "message"],
			[onManualEntryRejected, "Overlaps", "manualEntryRejected", "messageWithReason"],
		])("translates the decision (%#)", async (trigger, rejectionReason, copy, variant) => {
			await trigger({ ...decision, rejectionReason });

			const notification = lastNotification();
			expect(notification.message).not.toContain("{");
			expect(i18nOf(notification)).toMatchObject({
				titleKey: `common:notifications.content.${copy}.title`,
				messageKey: `common:notifications.content.${copy}.${variant}`,
				params: expect.objectContaining({ approverName: "Morgan Manager" }),
			});
		});
	});

	it("links manager clock-out approval notifications to the unified inbox", async () => {
		await onClockOutPendingApprovalToManager({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			times: null,
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
				times: null,
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
					"Your clock-out approval was rejected by Morgan Manager. The recorded times remain unchanged and are excluded from approved payroll time. Reason: Outside policy",
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
