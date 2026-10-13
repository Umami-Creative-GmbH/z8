/**
 * Compliance Notification Triggers
 *
 * Functions to create notifications in response to ArbZG compliance events.
 * These are fire-and-forget - they don't throw on failure.
 *
 * Every notification carries translation keys and typed params, so each channel
 * renders it in the recipient's language (#812). Exception types are ICU `select`
 * labels; instants are shown in the organization's zone.
 */

import { db } from "@/db";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import {
	fillNotificationTemplate,
	type NotificationParamValue,
	notificationParam,
} from "./notification-params";
import { createNotification, createNotificationForManager } from "./notification-service";

const logger = createLogger("ComplianceNotificationTriggers");

/** The English label of an exception type, for the stored English text. */
const formatExceptionType = (type: string): string => {
	switch (type) {
		case "rest_period":
			return "rest period";
		case "overtime_daily":
			return "daily overtime";
		case "overtime_weekly":
			return "weekly overtime";
		case "overtime_monthly":
			return "monthly overtime";
		default:
			return "compliance";
	}
};

const OVERTIME_PERIOD_TEXT = {
	daily: "today",
	weekly: "this week",
	monthly: "this month",
} as const;

/**
 * Typed instant param in the organization's zone, so the server's zone never shows.
 */
async function organizationInstant(
	organizationId: string,
	at: Date,
): Promise<NotificationParamValue> {
	const timeZone = await loadOrganizationTimezone(db, organizationId);
	return notificationParam.zonedInstant(instantFromDate(at), timeZone);
}

const exceptionRequestedCopy = {
	titleKey: "common:notifications.content.complianceExceptionRequested.title",
	titleDefault: "Compliance exception requested",
	messageKey: "common:notifications.content.complianceExceptionRequested.message",
	messageDefault:
		'{employeeName} requested a {exceptionType, select, rest_period {rest period} overtime_daily {daily overtime} overtime_weekly {weekly overtime} overtime_monthly {monthly overtime} other {compliance}} exception: "{reason}"',
} as const satisfies NotificationCopy;

const exceptionApprovedCopy = {
	titleKey: "common:notifications.content.complianceExceptionApproved.title",
	titleDefault: "Exception approved",
	messageKey: "common:notifications.content.complianceExceptionApproved.message",
	messageDefault:
		"Your {exceptionType, select, rest_period {rest period} overtime_daily {daily overtime} overtime_weekly {weekly overtime} overtime_monthly {monthly overtime} other {compliance}} exception was approved by {approverName}. Valid until {validUntil}.",
} as const satisfies NotificationCopy;

const exceptionRejectedCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.complianceExceptionRejected.title",
		titleDefault: "Exception rejected",
		messageKey: "common:notifications.content.complianceExceptionRejected.message",
		messageDefault:
			"Your {exceptionType, select, rest_period {rest period} overtime_daily {daily overtime} overtime_weekly {weekly overtime} overtime_monthly {monthly overtime} other {compliance}} exception was rejected by {approverName}.",
	},
	withReason: {
		titleKey: "common:notifications.content.complianceExceptionRejected.title",
		titleDefault: "Exception rejected",
		messageKey: "common:notifications.content.complianceExceptionRejected.messageWithReason",
		messageDefault:
			'Your {exceptionType, select, rest_period {rest period} overtime_daily {daily overtime} overtime_weekly {weekly overtime} overtime_monthly {monthly overtime} other {compliance}} exception was rejected by {approverName}. Reason: "{reason}"',
	},
} as const satisfies Record<string, NotificationCopy>;

const exceptionExpiredCopy = {
	titleKey: "common:notifications.content.complianceExceptionExpired.title",
	titleDefault: "Exception expired",
	messageKey: "common:notifications.content.complianceExceptionExpired.message",
	messageDefault:
		"Your {exceptionType, select, rest_period {rest period} overtime_daily {daily overtime} overtime_weekly {weekly overtime} overtime_monthly {monthly overtime} other {compliance}} pre-approval has expired (24 hours passed without use).",
} as const satisfies NotificationCopy;

const restPeriodWarningCopy = {
	titleKey: "common:notifications.content.restPeriodWarning.title",
	titleDefault: "Rest period reminder",
	messageKey: "common:notifications.content.restPeriodWarning.message",
	messageDefault:
		"You have {remaining} of required rest remaining. Next allowed clock-in: {nextAllowedClockIn}.",
} as const satisfies NotificationCopy;

const overtimeWarningCopy = {
	titleKey: "common:notifications.content.overtimeWarning.title",
	titleDefault: "Overtime threshold approaching",
	messageKey: "common:notifications.content.overtimeWarning.message",
	messageDefault:
		"You've worked {worked} {period, select, daily {today} weekly {this week} other {this month}} ({percent}% of the {limit} limit).",
} as const satisfies NotificationCopy;

const restPeriodViolationCopy = {
	titleKey: "common:notifications.content.restPeriodViolation.title",
	titleDefault: "Rest period violation logged",
	messageKey: "common:notifications.content.restPeriodViolation.message",
	messageDefault: "{description}",
} as const satisfies NotificationCopy;

const overtimeViolationCopy = {
	titleKey: "common:notifications.content.overtimeViolation.title",
	titleDefault: "Overtime violation logged",
	messageKey: "common:notifications.content.overtimeViolation.message",
	messageDefault: "{description}",
} as const satisfies NotificationCopy;

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
			const copy = exceptionRequestedCopy;
			const i18nParams = {
				employeeName: params.employeeName,
				exceptionType: params.exceptionType,
				reason: params.reason,
			};
			await createNotificationForManager({
				managerId: params.managerId,
				organizationId: params.organizationId,
				type: "compliance_exception_requested",
				title: copy.titleDefault,
				message: fillNotificationTemplate(
					'{employeeName} requested a {label} exception: "{reason}"',
					{
						...i18nParams,
						label: formatExceptionType(params.exceptionType),
					},
				),
				entityType: "compliance_exception",
				entityId: params.exceptionId,
				actionUrl: "/settings/compliance",
				metadata: { i18n: translatedContent(copy, i18nParams).i18n },
			});
		}
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger compliance exception requested notification",
		);
	}
}

/**
 * Notify employee that their compliance exception was approved
 */
export async function onComplianceExceptionApproved(
	params: ExceptionApprovedParams,
): Promise<void> {
	try {
		const copy = exceptionApprovedCopy;
		const i18nParams = {
			exceptionType: params.exceptionType,
			approverName: params.approverName,
			validUntil: await organizationInstant(params.organizationId, params.validUntil),
		};
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "compliance_exception_approved",
			title: copy.titleDefault,
			message: fillNotificationTemplate(
				"Your {label} exception was approved by {approverName}. Valid until {validUntil}.",
				{ ...i18nParams, label: formatExceptionType(params.exceptionType) },
			),
			entityType: "compliance_exception",
			entityId: params.exceptionId,
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger compliance exception approved notification");
	}
}

/**
 * Notify employee that their compliance exception was rejected
 */
export async function onComplianceExceptionRejected(
	params: ExceptionRejectedParams,
): Promise<void> {
	try {
		const copy = params.reason
			? exceptionRejectedCopy.withReason
			: exceptionRejectedCopy.withoutReason;
		const i18nParams = {
			exceptionType: params.exceptionType,
			approverName: params.approverName,
			...(params.reason ? { reason: params.reason } : {}),
		};
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "compliance_exception_rejected",
			title: copy.titleDefault,
			message: fillNotificationTemplate(
				params.reason
					? 'Your {label} exception was rejected by {approverName}. Reason: "{reason}"'
					: "Your {label} exception was rejected by {approverName}.",
				{ ...i18nParams, label: formatExceptionType(params.exceptionType) },
			),
			entityType: "compliance_exception",
			entityId: params.exceptionId,
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
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
		const copy = exceptionExpiredCopy;
		const i18nParams = { exceptionType: params.exceptionType };
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "compliance_exception_expired",
			title: copy.titleDefault,
			message: fillNotificationTemplate(
				"Your {label} pre-approval has expired (24 hours passed without use).",
				{
					label: formatExceptionType(params.exceptionType),
				},
			),
			entityType: "compliance_exception",
			entityId: params.exceptionId,
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
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
		const copy = restPeriodWarningCopy;
		const i18nParams = {
			remaining: notificationParam.duration(Math.round(params.hoursRemaining * 60)),
			nextAllowedClockIn: await organizationInstant(
				params.organizationId,
				params.nextAllowedClockIn,
			),
		};
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "rest_period_warning",
			title: copy.titleDefault,
			message: fillNotificationTemplate(copy.messageDefault, i18nParams),
			entityType: "compliance",
			entityId: "rest_period",
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
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
		const copy = overtimeWarningCopy;
		const i18nParams = {
			worked: notificationParam.duration(Math.round(params.currentMinutes)),
			period: params.overtimeType,
			percent: Math.round(params.percentOfThreshold),
			limit: notificationParam.duration(Math.round(params.thresholdMinutes)),
		};

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "overtime_warning",
			title: copy.titleDefault,
			message: fillNotificationTemplate(
				"You've worked {worked} {periodText} ({percent}% of the {limit} limit).",
				{
					...i18nParams,
					periodText: OVERTIME_PERIOD_TEXT[params.overtimeType],
				},
			),
			entityType: "compliance",
			entityId: `overtime_${params.overtimeType}`,
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger overtime warning notification");
	}
}

/**
 * Notify employee that a rest period violation has been logged. The description
 * is the caller's text and is shown as given.
 */
export async function onRestPeriodViolation(params: ViolationParams): Promise<void> {
	try {
		const copy = restPeriodViolationCopy;
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "rest_period_violation",
			title: copy.titleDefault,
			message: params.description,
			entityType: "work_period",
			entityId: params.workPeriodId || "violation",
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, { description: params.description }).i18n },
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger rest period violation notification");
	}
}

/**
 * Notify employee that an overtime violation has been logged. The description
 * is the caller's text and is shown as given.
 */
export async function onOvertimeViolation(params: ViolationParams): Promise<void> {
	try {
		const copy = overtimeViolationCopy;
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "overtime_violation",
			title: copy.titleDefault,
			message: params.description,
			entityType: "work_period",
			entityId: params.workPeriodId || "violation",
			actionUrl: "/time-tracking",
			metadata: { i18n: translatedContent(copy, { description: params.description }).i18n },
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger overtime violation notification");
	}
}
