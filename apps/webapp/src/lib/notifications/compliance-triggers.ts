/**
 * Compliance Notification Triggers
 *
 * Functions to create notifications in response to ArbZG compliance events.
 * These are fire-and-forget - they don't throw on failure.
 */

import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { createNotification, createNotificationForManager } from "./notification-service";

const logger = createLogger("ComplianceNotificationTriggers");

// Helper to format exception type for display
const formatExceptionType = (type: string): string => {
	switch (type) {
		case "rest_period":
			return "Rest Period";
		case "overtime_daily":
			return "Daily Overtime";
		case "overtime_weekly":
			return "Weekly Overtime";
		case "overtime_monthly":
			return "Monthly Overtime";
		default:
			return type;
	}
};

// Helper to format date for display
const formatDate = (date: Date): string => {
	return DateTime.fromJSDate(date).toLocaleString({
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

// =============================================================================
// Exception Request Notifications
// =============================================================================

interface ExceptionRequestedParams {
	exceptionId: string;
	employeeId: string;
	employeeName: string;
	organizationId: string;
	exceptionType: string;
	reason: string;
	managerId?: string;
}

interface ExceptionApprovedParams {
	exceptionId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	exceptionType: string;
	approverName: string;
	validUntil: Date;
}

interface ExceptionRejectedParams {
	exceptionId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	exceptionType: string;
	approverName: string;
	reason?: string;
}

interface ExceptionExpiredParams {
	exceptionId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	exceptionType: string;
}

/**
 * Notify manager that an employee has requested a compliance exception
 */
export async function onComplianceExceptionRequested(
	params: ExceptionRequestedParams,
): Promise<void> {
	try {
		if (params.managerId) {
			await createNotificationForManager({
				managerId: params.managerId,
				organizationId: params.organizationId,
				type: "compliance_exception_requested",
				title: "Compliance exception requested",
				message: `${params.employeeName} requested a ${formatExceptionType(params.exceptionType)} exception: "${params.reason}"`,
				entityType: "compliance_exception",
				entityId: params.exceptionId,
				actionUrl: "/settings/compliance",
			});
		}
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger compliance exception requested notification");
	}
}

/**
 * Notify employee that their compliance exception was approved
 */
export async function onComplianceExceptionApproved(params: ExceptionApprovedParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "compliance_exception_approved",
			title: "Exception approved",
			message: `Your ${formatExceptionType(params.exceptionType)} exception was approved by ${params.approverName}. Valid until ${formatDate(params.validUntil)}.`,
			entityType: "compliance_exception",
			entityId: params.exceptionId,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger compliance exception approved notification");
	}
}

/**
 * Notify employee that their compliance exception was rejected
 */
export async function onComplianceExceptionRejected(params: ExceptionRejectedParams): Promise<void> {
	try {
		const reasonText = params.reason ? ` Reason: "${params.reason}"` : "";
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "compliance_exception_rejected",
			title: "Exception rejected",
			message: `Your ${formatExceptionType(params.exceptionType)} exception was rejected by ${params.approverName}.${reasonText}`,
			entityType: "compliance_exception",
			entityId: params.exceptionId,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger compliance exception rejected notification");
	}
}

/**
 * Notify employee that their pre-approved exception has expired (unused)
 */
export async function onComplianceExceptionExpired(params: ExceptionExpiredParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "compliance_exception_expired",
			title: "Exception expired",
			message: `Your ${formatExceptionType(params.exceptionType)} pre-approval has expired (24 hours passed without use).`,
			entityType: "compliance_exception",
			entityId: params.exceptionId,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger compliance exception expired notification");
	}
}

// =============================================================================
// Proactive Compliance Warnings
// =============================================================================

interface RestPeriodWarningParams {
	employeeUserId: string;
	organizationId: string;
	hoursRemaining: number;
	nextAllowedClockIn: Date;
}

interface OvertimeWarningParams {
	employeeUserId: string;
	organizationId: string;
	overtimeType: "daily" | "weekly" | "monthly";
	currentMinutes: number;
	thresholdMinutes: number;
	percentOfThreshold: number;
}

interface ViolationParams {
	employeeUserId: string;
	organizationId: string;
	violationType: string;
	description: string;
	workPeriodId?: string;
}

/**
 * Notify employee about upcoming rest period requirement
 */
export async function onRestPeriodWarning(params: RestPeriodWarningParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "rest_period_warning",
			title: "Rest period reminder",
			message: `You have ${params.hoursRemaining.toFixed(1)} hours of required rest remaining. Next allowed clock-in: ${formatDate(params.nextAllowedClockIn)}.`,
			entityType: "compliance",
			entityId: "rest_period",
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger rest period warning notification");
	}
}

/**
 * Notify employee about approaching overtime threshold
 */
export async function onOvertimeWarning(params: OvertimeWarningParams): Promise<void> {
	try {
		const periodText =
			params.overtimeType === "daily"
				? "today"
				: params.overtimeType === "weekly"
					? "this week"
					: "this month";
		const hoursWorked = (params.currentMinutes / 60).toFixed(1);
		const hoursLimit = (params.thresholdMinutes / 60).toFixed(1);

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "overtime_warning",
			title: `Overtime threshold approaching`,
			message: `You've worked ${hoursWorked}h ${periodText} (${params.percentOfThreshold.toFixed(0)}% of ${hoursLimit}h limit).`,
			entityType: "compliance",
			entityId: `overtime_${params.overtimeType}`,
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger overtime warning notification");
	}
}

/**
 * Notify employee that a rest period violation has been logged
 */
export async function onRestPeriodViolation(params: ViolationParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "rest_period_violation",
			title: "Rest period violation logged",
			message: params.description,
			entityType: "work_period",
			entityId: params.workPeriodId || "violation",
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger rest period violation notification");
	}
}

/**
 * Notify employee that an overtime violation has been logged
 */
export async function onOvertimeViolation(params: ViolationParams): Promise<void> {
	try {
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "overtime_violation",
			title: "Overtime violation logged",
			message: params.description,
			entityType: "work_period",
			entityId: params.workPeriodId || "violation",
			actionUrl: "/time-tracking",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger overtime violation notification");
	}
}
