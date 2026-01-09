/**
 * Notification Triggers
 *
 * Functions to create notifications in response to business events.
 * These are fire-and-forget - they don't throw on failure.
 */

import { createLogger } from "@/lib/logger";
import { createNotification } from "./notification-service";

const logger = createLogger("NotificationTriggers");

// =============================================================================
// Absence Request Notifications
// =============================================================================

interface AbsenceRequestParams {
	absenceId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	categoryName: string;
	startDate: Date;
	endDate: Date;
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
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_submitted",
			title: "Absence request submitted",
			message: `Your ${params.categoryName} request for ${formatDate(params.startDate)} - ${formatDate(params.endDate)} has been submitted and is pending approval.`,
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
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "approval_request_submitted",
			title: "New absence request",
			message: `${params.employeeName} requested ${params.categoryName} for ${formatDate(params.startDate)} - ${formatDate(params.endDate)}.`,
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
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: "Absence request approved",
			message: `Your ${params.categoryName} request for ${formatDate(params.startDate)} - ${formatDate(params.endDate)} was approved by ${params.approverName}.`,
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
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

		const reasonText = params.rejectionReason ? ` Reason: ${params.rejectionReason}` : "";

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_rejected",
			title: "Absence request rejected",
			message: `Your ${params.categoryName} request for ${formatDate(params.startDate)} - ${formatDate(params.endDate)} was rejected by ${params.approverName}.${reasonText}`,
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
