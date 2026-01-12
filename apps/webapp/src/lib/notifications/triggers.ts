/**
 * Notification Triggers
 *
 * Functions to create notifications in response to business events.
 * These are fire-and-forget - they don't throw on failure.
 */

import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { createNotification } from "./notification-service";

const logger = createLogger("NotificationTriggers");

// Helper to format YYYY-MM-DD date strings
const formatDateStr = (dateStr: string) => {
	const dt = DateTime.fromISO(dateStr);
	return dt.toLocaleString({ month: "short", day: "numeric" });
};

// =============================================================================
// Absence Request Notifications
// =============================================================================

interface AbsenceRequestParams {
	absenceId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	categoryName: string;
	startDate: string; // YYYY-MM-DD
	endDate: string; // YYYY-MM-DD
}

interface AbsenceApprovalParams extends AbsenceRequestParams {
	approverName: string;
}

interface AbsenceRejectionParams extends AbsenceApprovalParams {
	rejectionReason?: string;
}

interface AbsenceSubmittedToManagerParams extends AbsenceRequestParams {
	managerUserId: string;
	managerName: string;
}

/**
 * Notify employee that their absence request was submitted
 */
export async function onAbsenceRequestSubmitted(params: AbsenceRequestParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_submitted",
			title: "Absence request submitted",
			message: `Your ${params.categoryName} request for ${formatDateStr(params.startDate)} - ${formatDateStr(params.endDate)} has been submitted and is pending approval.`,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger absence submitted notification");
	}
}

/**
 * Notify manager that an absence request needs approval
 */
export async function onAbsenceRequestPendingApproval(
	params: AbsenceSubmittedToManagerParams,
): Promise<void> {
	try {
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "approval_request_submitted",
			title: "New absence request",
			message: `${params.employeeName} requested ${params.categoryName} for ${formatDateStr(params.startDate)} - ${formatDateStr(params.endDate)}.`,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/approvals",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger absence pending approval notification");
	}
}

/**
 * Notify employee that their absence request was approved
 */
export async function onAbsenceRequestApproved(params: AbsenceApprovalParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: "Absence request approved",
			message: `Your ${params.categoryName} request for ${formatDateStr(params.startDate)} - ${formatDateStr(params.endDate)} was approved by ${params.approverName}.`,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger absence approved notification");
	}
}

/**
 * Notify employee that their absence request was rejected
 */
export async function onAbsenceRequestRejected(params: AbsenceRejectionParams): Promise<void> {
	try {
		const reasonText = params.rejectionReason ? ` Reason: ${params.rejectionReason}` : "";

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_rejected",
			title: "Absence request rejected",
			message: `Your ${params.categoryName} request for ${formatDateStr(params.startDate)} - ${formatDateStr(params.endDate)} was rejected by ${params.approverName}.${reasonText}`,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger absence rejected notification");
	}
}

// =============================================================================
// Time Correction Notifications
// =============================================================================

interface TimeCorrectionParams {
	workPeriodId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	originalTime: Date;
	correctedTime: Date;
}

interface TimeCorrectionSubmittedToManagerParams extends TimeCorrectionParams {
	managerUserId: string;
	reason?: string;
}

interface TimeCorrectionApprovalParams extends TimeCorrectionParams {
	approverName: string;
}

interface TimeCorrectionRejectionParams extends TimeCorrectionApprovalParams {
	rejectionReason?: string;
}

/**
 * Notify employee that their time correction was submitted
 */
export async function onTimeCorrectionSubmitted(params: TimeCorrectionParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_submitted",
			title: "Time correction submitted",
			message: `Your time correction request has been submitted and is pending approval.`,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger time correction submitted notification");
	}
}

/**
 * Notify manager that a time correction needs approval
 */
export async function onTimeCorrectionPendingApproval(
	params: TimeCorrectionSubmittedToManagerParams,
): Promise<void> {
	try {
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "approval_request_submitted",
			title: "New time correction request",
			message: `${params.employeeName} submitted a time correction request.${params.reason ? ` Reason: ${params.reason}` : ""}`,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/approvals",
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger time correction pending approval notification",
		);
	}
}

/**
 * Notify employee that their time correction was approved
 */
export async function onTimeCorrectionApproved(
	params: TimeCorrectionApprovalParams,
): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_approved",
			title: "Time correction approved",
			message: `Your time correction request was approved by ${params.approverName}.`,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger time correction approved notification");
	}
}

/**
 * Notify employee that their time correction was rejected
 */
export async function onTimeCorrectionRejected(
	params: TimeCorrectionRejectionParams,
): Promise<void> {
	try {
		const reasonText = params.rejectionReason ? ` Reason: ${params.rejectionReason}` : "";

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_rejected",
			title: "Time correction rejected",
			message: `Your time correction request was rejected by ${params.approverName}.${reasonText}`,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger time correction rejected notification");
	}
}

// =============================================================================
// Team Notifications
// =============================================================================

interface TeamMemberParams {
	teamId: string;
	teamName: string;
	memberUserId: string;
	memberName: string;
	organizationId: string;
	performedByName: string;
}

/**
 * Notify user they were added to a team
 */
export async function onTeamMemberAdded(params: TeamMemberParams): Promise<void> {
	try {
		await createNotification({
			userId: params.memberUserId,
			organizationId: params.organizationId,
			type: "team_member_added",
			title: "Added to team",
			message: `You have been added to the ${params.teamName} team by ${params.performedByName}.`,
			entityType: "team",
			entityId: params.teamId,
			actionUrl: "/team",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger team member added notification");
	}
}

/**
 * Notify user they were removed from a team
 */
export async function onTeamMemberRemoved(params: TeamMemberParams): Promise<void> {
	try {
		await createNotification({
			userId: params.memberUserId,
			organizationId: params.organizationId,
			type: "team_member_removed",
			title: "Removed from team",
			message: `You have been removed from the ${params.teamName} team by ${params.performedByName}.`,
			entityType: "team",
			entityId: params.teamId,
			actionUrl: "/team",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger team member removed notification");
	}
}

// =============================================================================
// Security Notifications
// =============================================================================

interface SecurityParams {
	userId: string;
	organizationId: string;
}

/**
 * Notify user their password was changed
 */
export async function onPasswordChanged(params: SecurityParams): Promise<void> {
	try {
		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "password_changed",
			title: "Password changed",
			message:
				"Your password was successfully changed. If you didn't make this change, please contact support immediately.",
			actionUrl: "/settings/security",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger password changed notification");
	}
}

/**
 * Notify user 2FA was enabled
 */
export async function onTwoFactorEnabled(params: SecurityParams): Promise<void> {
	try {
		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "two_factor_enabled",
			title: "Two-factor authentication enabled",
			message: "Two-factor authentication has been enabled on your account for added security.",
			actionUrl: "/settings/security",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger 2FA enabled notification");
	}
}

/**
 * Notify user 2FA was disabled
 */
export async function onTwoFactorDisabled(params: SecurityParams): Promise<void> {
	try {
		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "two_factor_disabled",
			title: "Two-factor authentication disabled",
			message:
				"Two-factor authentication has been disabled on your account. We recommend re-enabling it for security.",
			actionUrl: "/settings/security",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger 2FA disabled notification");
	}
}

// =============================================================================
// Reminder Notifications
// =============================================================================

interface BirthdayReminderParams {
	userId: string;
	organizationId: string;
	birthdayPersonName: string;
	birthdayDate: Date;
}

/**
 * Notify user about an upcoming birthday
 */
export async function onBirthdayReminder(params: BirthdayReminderParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { month: "long", day: "numeric" });

		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "birthday_reminder",
			title: "Upcoming birthday",
			message: `${params.birthdayPersonName}'s birthday is on ${formatDate(params.birthdayDate)}.`,
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger birthday reminder notification");
	}
}

interface VacationBalanceAlertParams {
	userId: string;
	organizationId: string;
	remainingDays: number;
	expiryDate?: Date;
}

/**
 * Notify user about low vacation balance or expiring days
 */
export async function onVacationBalanceAlert(params: VacationBalanceAlertParams): Promise<void> {
	try {
		let message: string;

		if (params.expiryDate) {
			const formatDate = (date: Date) =>
				date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
			message = `You have ${params.remainingDays} vacation day${params.remainingDays === 1 ? "" : "s"} expiring on ${formatDate(params.expiryDate)}. Use them before they expire!`;
		} else {
			message = `You have ${params.remainingDays} vacation day${params.remainingDays === 1 ? "" : "s"} remaining. Don't forget to take some time off!`;
		}

		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "vacation_balance_alert",
			title: "Vacation balance reminder",
			message,
			actionUrl: "/absences",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger vacation balance alert notification");
	}
}

// =============================================================================
// Shift Scheduling Notifications
// =============================================================================

interface SchedulePublishedParams {
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	shiftCount: number;
	dateRange: { start: Date; end: Date };
}

interface ShiftAssignedParams {
	shiftId: string;
	employeeUserId: string;
	organizationId: string;
	shiftDate: Date;
	startTime: string;
	endTime: string;
	assignedByName: string;
}

interface ShiftSwapRequestParams {
	requestId: string;
	shiftId: string;
	organizationId: string;
	requesterName: string;
	shiftDate: Date;
	startTime: string;
	endTime: string;
}

interface ShiftSwapRequestToManagerParams extends ShiftSwapRequestParams {
	managerUserId: string;
	targetEmployeeName?: string;
}

interface ShiftSwapRequestToTargetParams extends ShiftSwapRequestParams {
	targetEmployeeUserId: string;
}

interface ShiftSwapApprovalParams {
	requestId: string;
	shiftId: string;
	organizationId: string;
	requesterUserId: string;
	approverName: string;
	shiftDate: Date;
}

interface ShiftSwapRejectionParams extends ShiftSwapApprovalParams {
	rejectionReason?: string;
}

interface ShiftPickupParams {
	shiftId: string;
	organizationId: string;
	shiftDate: Date;
	startTime: string;
	endTime: string;
}

interface OpenShiftAvailableParams extends ShiftPickupParams {
	teamMemberUserIds: string[];
}

interface ShiftPickupApprovedParams {
	shiftId: string;
	organizationId: string;
	employeeUserId: string;
	shiftDate: Date;
	approverName: string;
}

/**
 * Notify employee that their schedule was published (batched per employee)
 */
export async function onSchedulePublished(params: SchedulePublishedParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "schedule_published",
			title: "New schedule published",
			message: `${params.shiftCount} shift${params.shiftCount === 1 ? " has" : "s have"} been published for ${formatDate(params.dateRange.start)} - ${formatDate(params.dateRange.end)}.`,
			actionUrl: "/scheduling",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger schedule published notification");
	}
}

/**
 * Notify employee they were assigned to a shift
 */
export async function onShiftAssigned(params: ShiftAssignedParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "shift_assigned",
			title: "Shift assigned",
			message: `You have been assigned a shift on ${formatDate(params.shiftDate)} from ${params.startTime} to ${params.endTime} by ${params.assignedByName}.`,
			entityType: "shift",
			entityId: params.shiftId,
			actionUrl: "/scheduling",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger shift assigned notification");
	}
}

/**
 * Notify manager about a shift swap request
 */
export async function onShiftSwapRequestedToManager(
	params: ShiftSwapRequestToManagerParams,
): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		const targetText = params.targetEmployeeName
			? ` to swap with ${params.targetEmployeeName}`
			: "";

		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "shift_swap_requested",
			title: "Shift swap request",
			message: `${params.requesterName} requested${targetText} for the shift on ${formatDate(params.shiftDate)} (${params.startTime} - ${params.endTime}).`,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/approvals",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger shift swap request manager notification");
	}
}

/**
 * Notify target employee about a shift swap request directed at them
 */
export async function onShiftSwapRequestedToTarget(
	params: ShiftSwapRequestToTargetParams,
): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		await createNotification({
			userId: params.targetEmployeeUserId,
			organizationId: params.organizationId,
			type: "shift_swap_requested",
			title: "Shift swap request",
			message: `${params.requesterName} wants to swap shifts with you for ${formatDate(params.shiftDate)} (${params.startTime} - ${params.endTime}).`,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/scheduling",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger shift swap request target notification");
	}
}

/**
 * Notify requester their shift swap was approved
 */
export async function onShiftSwapApproved(params: ShiftSwapApprovalParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "shift_swap_approved",
			title: "Shift swap approved",
			message: `Your shift swap request for ${formatDate(params.shiftDate)} was approved by ${params.approverName}.`,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/scheduling",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger shift swap approved notification");
	}
}

/**
 * Notify requester their shift swap was rejected
 */
export async function onShiftSwapRejected(params: ShiftSwapRejectionParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		const reasonText = params.rejectionReason ? ` Reason: ${params.rejectionReason}` : "";

		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "shift_swap_rejected",
			title: "Shift swap rejected",
			message: `Your shift swap request for ${formatDate(params.shiftDate)} was rejected by ${params.approverName}.${reasonText}`,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/scheduling",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger shift swap rejected notification");
	}
}

/**
 * Notify team members about an open shift available for pickup
 */
export async function onOpenShiftAvailable(params: OpenShiftAvailableParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		// Create notifications for all eligible team members
		await Promise.all(
			params.teamMemberUserIds.map((userId) =>
				createNotification({
					userId,
					organizationId: params.organizationId,
					type: "shift_pickup_available",
					title: "Open shift available",
					message: `An open shift is available on ${formatDate(params.shiftDate)} from ${params.startTime} to ${params.endTime}.`,
					entityType: "shift",
					entityId: params.shiftId,
					actionUrl: "/scheduling",
				}),
			),
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger open shift available notification");
	}
}

/**
 * Notify employee their shift pickup was approved
 */
export async function onShiftPickupApproved(params: ShiftPickupApprovedParams): Promise<void> {
	try {
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "shift_pickup_approved",
			title: "Shift pickup approved",
			message: `Your request to pick up the shift on ${formatDate(params.shiftDate)} was approved by ${params.approverName}.`,
			entityType: "shift",
			entityId: params.shiftId,
			actionUrl: "/scheduling",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger shift pickup approved notification");
	}
}
