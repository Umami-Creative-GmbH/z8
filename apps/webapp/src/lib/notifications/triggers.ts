/**
 * Notification Triggers
 *
 * Functions to create notifications in response to business events.
 * These are fire-and-forget - they don't throw on failure.
 */

import {
	instantFromDate,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { EntryTime, WorkPeriodEntryTimes } from "./entry-times";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import {
	fillNotificationTemplate,
	type NotificationParamValue,
	notificationParam,
} from "./notification-params";
import { createNotification } from "./notification-service";
import type { CreateNotificationParams } from "./types";

const logger = createLogger("NotificationTriggers");

const notificationCopy = {
	absenceRequestSubmitted: {
		titleKey: "common:notifications.content.absenceRequestSubmitted.title",
		titleDefault: "Absence request submitted",
		messageKey: "common:notifications.content.absenceRequestSubmitted.message",
		messageDefault:
			"Your {categoryName} request for {dateRange} has been submitted and is pending approval.",
	},
	passwordChanged: {
		titleKey: "common:notifications.content.passwordChanged.title",
		titleDefault: "Password changed",
		messageKey: "common:notifications.content.passwordChanged.message",
		messageDefault:
			"Your password was successfully changed. If you didn't make this change, please contact support immediately.",
	},
	shiftAssigned: {
		titleKey: "common:notifications.content.shiftAssigned.title",
		titleDefault: "Shift assigned",
		messageKey: "common:notifications.content.shiftAssigned.message",
		messageDefault:
			"You have been assigned a shift on {shiftDate} from {startTime} to {endTime} by {assignedByName}.",
	},
	teamMemberAdded: {
		titleKey: "common:notifications.content.teamMemberAdded.title",
		titleDefault: "Added to team",
		messageKey: "common:notifications.content.teamMemberAdded.message",
		messageDefault:
			"You have been added to the {teamName} team by {performedByName}.",
	},
	teamMemberRemoved: {
		titleKey: "common:notifications.content.teamMemberRemoved.title",
		titleDefault: "Removed from team",
		messageKey: "common:notifications.content.teamMemberRemoved.message",
		messageDefault:
			"You have been removed from the {teamName} team by {performedByName}.",
	},
} as const;

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
	/** The absence's absence days, for the email and its override variables. */
	days?: number;
}

/**
 * The absence's calendar days as typed params (#1149), so every channel and an
 * email override's `{{startDate}}`/`{{endDate}}` show them in the reader's language.
 */
function absenceDateParams(params: { startDate: string; endDate: string }) {
	const start = parsePlainDate(params.startDate);
	const end = parsePlainDate(params.endDate);
	return {
		startDate: notificationParam.plainDate(start),
		endDate: notificationParam.plainDate(end),
		dateRange: notificationParam.plainDateRange(start, end),
	};
}

/** What an absence decision's email and override variables need (#1152). */
function absenceDecisionParams(params: AbsenceApprovalParams) {
	return {
		approverName: params.approverName,
		categoryName: params.categoryName,
		...absenceDateParams(params),
		...(params.days === undefined ? {} : { days: params.days }),
	};
}

function entryTimeParam(time: EntryTime, preset: "dateMedium" | "time") {
	return notificationParam.entryInstant(instantFromDate(time.at), time.utcOffsetMinutes, preset);
}

interface AbsenceRejectionParams extends AbsenceApprovalParams {
	rejectionReason?: string;
}

interface AbsenceSubmittedToManagerParams extends AbsenceRequestParams {
	managerUserId: string;
	managerName: string;
	days?: number;
	notes?: string | null;
}

interface AbsenceRecordedByManagerParams extends AbsenceRequestParams {
	managerName: string;
	days: number;
}

interface ApprovedAbsenceCancelledByEmployeeParams {
	absenceId: string;
	managerUserId: string;
	employeeName: string;
	organizationId: string;
	categoryName: string;
	startDate: string;
	endDate: string;
}

const absencePendingApprovalCopy = {
	titleKey: "common:notifications.content.newAbsenceRequest.title",
	titleDefault: "New absence request",
	messageKey: "common:notifications.content.newAbsenceRequest.message",
	messageDefault: "{employeeName} requested {categoryName} for {dateRange}.",
} as const satisfies NotificationCopy;

const absenceApprovedCopy = {
	titleKey: "common:notifications.content.absenceRequestApproved.title",
	titleDefault: "Absence request approved",
	messageKey: "common:notifications.content.absenceRequestApproved.message",
	messageDefault: "Your {categoryName} request for {dateRange} was approved by {approverName}.",
} as const satisfies NotificationCopy;

const absenceRejectedCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.absenceRequestRejected.title",
		titleDefault: "Absence request rejected",
		messageKey: "common:notifications.content.absenceRequestRejected.message",
		messageDefault: "Your {categoryName} request for {dateRange} was rejected by {approverName}.",
	},
	withReason: {
		titleKey: "common:notifications.content.absenceRequestRejected.title",
		titleDefault: "Absence request rejected",
		messageKey: "common:notifications.content.absenceRequestRejected.messageWithReason",
		messageDefault:
			"Your {categoryName} request for {dateRange} was rejected by {approverName}. Reason: {rejectionReason}",
	},
} as const satisfies Record<string, NotificationCopy>;

const absenceRecordedCopy = {
	titleKey: "common:notifications.content.absenceRecorded.title",
	titleDefault: "Absence recorded",
	messageKey: "common:notifications.content.absenceRecorded.message",
	messageDefault: "{managerName} recorded {absenceType} for {dateRange} on your behalf.",
} as const satisfies NotificationCopy;

// Keeps the trigger's type until #1136 gives the cancellation its own one.
const approvedAbsenceCancelledCopy = {
	titleKey: "common:notifications.content.approvedAbsenceCancelled.title",
	titleDefault: "Approved absence cancelled",
	messageKey: "common:notifications.content.approvedAbsenceCancelled.message",
	messageDefault: "{employeeName} cancelled approved {categoryName} for {dateRange}.",
} as const satisfies NotificationCopy;

/**
 * Notify employee that their absence request was submitted
 */
export async function onAbsenceRequestSubmitted(
	params: AbsenceRequestParams & { managerName?: string; days?: number },
): Promise<void> {
	try {
		// The dates live in the params only, so the email's `{{startDate}}`/`{{endDate}}`
		// read them as calendar days in the recipient language too.
		const content = translatedContent(notificationCopy.absenceRequestSubmitted, {
			categoryName: params.categoryName,
			...absenceDateParams(params),
		});

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_submitted",
			title: content.title,
			message: content.message,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
			metadata: {
				absenceType: params.categoryName,
				managerName: params.managerName,
				days: params.days,
				i18n: content.i18n,
			},
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger absence submitted notification",
		);
	}
}

/**
 * The approver's absence pending-approval title, message and `metadata.i18n`: for its
 * trigger and for rows the demo seed writes directly.
 */
export function absencePendingApprovalContent(
	params: Pick<
		AbsenceSubmittedToManagerParams,
		"employeeName" | "categoryName" | "startDate" | "endDate" | "days" | "notes"
	>,
) {
	return translatedContent(absencePendingApprovalCopy, {
		employeeName: params.employeeName,
		categoryName: params.categoryName,
		...absenceDateParams(params),
		...(params.days === undefined ? {} : { days: params.days }),
		...(params.notes ? { notes: params.notes } : {}),
	});
}

/**
 * Notify manager that an absence request needs approval
 */
export async function onAbsenceRequestPendingApproval(
	params: AbsenceSubmittedToManagerParams,
): Promise<void> {
	try {
		const content = absencePendingApprovalContent(params);
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "approval_request_submitted",
			title: content.title,
			message: content.message,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/approvals/inbox",
			// The params also carry the manager's email and its override variables (#1152).
			metadata: { approvalSubject: "absence", i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger absence pending approval notification",
		);
	}
}

/**
 * Notify employee that their absence request was approved
 */
export async function onAbsenceRequestApproved(
	params: AbsenceApprovalParams,
): Promise<void> {
	try {
		const content = translatedContent(absenceApprovedCopy, absenceDecisionParams(params));
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: content.title,
			message: content.message,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger absence approved notification",
		);
	}
}

export async function onAbsenceRecordedByManager(
	params: AbsenceRecordedByManagerParams,
): Promise<void> {
	try {
		const content = translatedContent(absenceRecordedCopy, {
			managerName: params.managerName,
			absenceType: params.categoryName,
			...absenceDateParams(params),
			days: params.days,
		});
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: content.title,
			message: content.message,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
			metadata: {
				// Picks the "recorded by manager" email.
				managerRecorded: true,
				managerName: params.managerName,
				absenceType: params.categoryName,
				days: params.days,
				i18n: content.i18n,
			},
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger manager-recorded absence notification",
		);
	}
}

export async function onApprovedAbsenceCancelledByEmployee(
	params: ApprovedAbsenceCancelledByEmployeeParams,
): Promise<void> {
	try {
		const content = translatedContent(approvedAbsenceCancelledCopy, {
			employeeName: params.employeeName,
			categoryName: params.categoryName,
			...absenceDateParams(params),
		});
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: content.title,
			message: content.message,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/team/absences",
			metadata: {
				approvedAbsenceCancelled: true,
				employeeName: params.employeeName,
				absenceType: params.categoryName,
				i18n: content.i18n,
			},
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger approved absence cancellation notification",
		);
	}
}

/**
 * Notify employee that their absence request was rejected
 */
export async function onAbsenceRequestRejected(
	params: AbsenceRejectionParams,
): Promise<void> {
	try {
		const content = translatedContent(
			params.rejectionReason ? absenceRejectedCopy.withReason : absenceRejectedCopy.withoutReason,
			{
				...absenceDecisionParams(params),
				...(params.rejectionReason ? { rejectionReason: params.rejectionReason } : {}),
			},
		);

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "absence_request_rejected",
			title: content.title,
			message: content.message,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/absences",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger absence rejected notification",
		);
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

interface TimeCorrectionSubmittedToManagerParams {
	workPeriodId: string;
	managerUserId: string;
	employeeName: string;
	organizationId: string;
	reason?: string;
	/**
	 * The work period as recorded and as the employee asks to correct it; both null
	 * when its entries cannot be read (the manager is still told, without times).
	 */
	original: WorkPeriodEntryTimes | null;
	corrected: WorkPeriodEntryTimes | null;
}

interface TimeCorrectionApprovalParams extends TimeCorrectionParams {
	approverName: string;
	/**
	 * The work period as corrected (the decided correction), each time at its entry's
	 * offset; null when its entries cannot be read.
	 */
	corrected: WorkPeriodEntryTimes | null;
}

/** The corrected times of a time correction decision's email (#1137). */
function correctedTimeParams(corrected: WorkPeriodEntryTimes | null) {
	if (!corrected) return {};
	return {
		date: entryTimeParam(corrected.clockIn, "dateMedium"),
		correctedClockIn: entryTimeParam(corrected.clockIn, "time"),
		...(corrected.clockOut
			? { correctedClockOut: entryTimeParam(corrected.clockOut, "time") }
			: {}),
	};
}

interface TimeCorrectionRejectionParams extends TimeCorrectionApprovalParams {
	rejectionReason?: string;
}

const timeCorrectionSubmittedCopy = {
	titleKey: "common:notifications.content.timeCorrectionSubmitted.title",
	titleDefault: "Time correction submitted",
	messageKey: "common:notifications.content.timeCorrectionSubmitted.message",
	messageDefault: "Your time correction request has been submitted and is pending approval.",
} as const satisfies NotificationCopy;

const timeCorrectionPendingApprovalCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.newTimeCorrectionRequest.title",
		titleDefault: "New time correction request",
		messageKey: "common:notifications.content.newTimeCorrectionRequest.message",
		messageDefault: "{employeeName} submitted a time correction request for {date}.",
	},
	withReason: {
		titleKey: "common:notifications.content.newTimeCorrectionRequest.title",
		titleDefault: "New time correction request",
		messageKey: "common:notifications.content.newTimeCorrectionRequest.messageWithReason",
		messageDefault:
			"{employeeName} submitted a time correction request for {date}. Reason: {reason}",
	},
	withoutDate: {
		titleKey: "common:notifications.content.newTimeCorrectionRequest.title",
		titleDefault: "New time correction request",
		messageKey: "common:notifications.content.newTimeCorrectionRequest.messageWithoutDate",
		messageDefault: "{employeeName} submitted a time correction request.",
	},
	withoutDateWithReason: {
		titleKey: "common:notifications.content.newTimeCorrectionRequest.title",
		titleDefault: "New time correction request",
		messageKey: "common:notifications.content.newTimeCorrectionRequest.messageWithoutDateWithReason",
		messageDefault: "{employeeName} submitted a time correction request. Reason: {reason}",
	},
} as const satisfies Record<string, NotificationCopy>;

/** The pending request's times as typed params, each at its own entry's offset. */
function pendingCorrectionTimeParams(
	original: WorkPeriodEntryTimes | null,
	corrected: WorkPeriodEntryTimes | null,
) {
	if (!original || !corrected) return {};
	return {
		date: entryTimeParam(original.clockIn, "dateMedium"),
		originalClockIn: entryTimeParam(original.clockIn, "time"),
		...(original.clockOut ? { originalClockOut: entryTimeParam(original.clockOut, "time") } : {}),
		correctedClockIn: entryTimeParam(corrected.clockIn, "time"),
		...(corrected.clockOut
			? { correctedClockOut: entryTimeParam(corrected.clockOut, "time") }
			: {}),
	};
}

const timeCorrectionApprovedCopy = {
	titleKey: "common:notifications.content.timeCorrectionApproved.title",
	titleDefault: "Time correction approved",
	messageKey: "common:notifications.content.timeCorrectionApproved.message",
	messageDefault: "Your time correction request was approved by {approverName}.",
} as const satisfies NotificationCopy;

const timeCorrectionRejectedCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.timeCorrectionRejected.title",
		titleDefault: "Time correction rejected",
		messageKey: "common:notifications.content.timeCorrectionRejected.message",
		messageDefault: "Your time correction request was rejected by {approverName}.",
	},
	withReason: {
		titleKey: "common:notifications.content.timeCorrectionRejected.title",
		titleDefault: "Time correction rejected",
		messageKey: "common:notifications.content.timeCorrectionRejected.messageWithReason",
		messageDefault:
			"Your time correction request was rejected by {approverName}. Reason: {rejectionReason}",
	},
} as const satisfies Record<string, NotificationCopy>;

/**
 * Notify employee that their time correction was submitted
 */
export async function onTimeCorrectionSubmitted(
	params: TimeCorrectionParams,
): Promise<void> {
	try {
		const content = translatedContent(timeCorrectionSubmittedCopy, {});
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_submitted",
			title: content.title,
			message: content.message,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger time correction submitted notification",
		);
	}
}

/**
 * The approver's time-correction pending-approval title, message and `metadata.i18n`
 * (without times when they are unknown): for its trigger and for rows the demo seed
 * writes directly.
 */
export function timeCorrectionPendingApprovalContent(
	params: Pick<
		TimeCorrectionSubmittedToManagerParams,
		"employeeName" | "reason" | "original" | "corrected"
	>,
) {
	const hasTimes = Boolean(params.original && params.corrected);
	const copy = hasTimes
		? params.reason
			? timeCorrectionPendingApprovalCopy.withReason
			: timeCorrectionPendingApprovalCopy.withoutReason
		: params.reason
			? timeCorrectionPendingApprovalCopy.withoutDateWithReason
			: timeCorrectionPendingApprovalCopy.withoutDate;
	return translatedContent(copy, {
		employeeName: params.employeeName,
		...(params.reason ? { reason: params.reason } : {}),
		...pendingCorrectionTimeParams(params.original, params.corrected),
	});
}

/**
 * Notify manager that a time correction needs approval
 */
export async function onTimeCorrectionPendingApproval(
	params: TimeCorrectionSubmittedToManagerParams,
): Promise<void> {
	try {
		const content = timeCorrectionPendingApprovalContent(params);
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "approval_request_submitted",
			title: content.title,
			message: content.message,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/approvals/inbox",
			// The params also carry the manager's email and its override variables (#1152).
			metadata: { approvalSubject: "time_correction", i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger time correction pending approval notification",
		);
	}
}

// =============================================================================
// Change Policy Clock-Out Approval Notifications
// =============================================================================

interface ClockOutApprovalParams {
	workPeriodId: string;
	employeeUserId: string;
	employeeName: string;
	organizationId: string;
	/** The submitted period's clock-in and clock-out entries; null when they cannot be read. */
	times: WorkPeriodEntryTimes | null;
	durationMinutes: number;
	idempotencyKey?: string;
	durable?: boolean;
}

interface ClockOutApprovalToManagerParams extends ClockOutApprovalParams {
	managerUserId: string;
}

const clockOutPendingApprovalCopy = {
	withDate: {
		titleKey: "common:notifications.content.clockOutPendingApproval.title",
		titleDefault: "Clock-out pending approval",
		messageKey: "common:notifications.content.clockOutPendingApproval.message",
		messageDefault: "Your clock-out on {date} ({duration}) is pending manager approval.",
	},
	withoutDate: {
		titleKey: "common:notifications.content.clockOutPendingApproval.title",
		titleDefault: "Clock-out pending approval",
		messageKey: "common:notifications.content.clockOutPendingApproval.messageWithoutDate",
		messageDefault: "Your clock-out ({duration}) is pending manager approval.",
	},
} as const satisfies Record<string, NotificationCopy>;

const clockOutApprovalRequiredCopy = {
	withTimes: {
		titleKey: "common:notifications.content.clockOutApprovalRequired.title",
		titleDefault: "Clock-out approval required",
		messageKey: "common:notifications.content.clockOutApprovalRequired.message",
		messageDefault:
			"{employeeName} clocked out on {date} ({startTime} – {endTime}, {duration}). Approval required.",
	},
	withoutTimes: {
		titleKey: "common:notifications.content.clockOutApprovalRequired.title",
		titleDefault: "Clock-out approval required",
		messageKey: "common:notifications.content.clockOutApprovalRequired.messageWithoutTimes",
		messageDefault: "{employeeName} clocked out ({duration}). Approval required.",
	},
} as const satisfies Record<string, NotificationCopy>;

const clockOutApprovedCopy = {
	titleKey: "common:notifications.content.clockOutApproved.title",
	titleDefault: "Clock-out approved",
	messageKey: "common:notifications.content.clockOutApproved.message",
	messageDefault: "Your clock-out was approved by {approverName}.",
} as const satisfies NotificationCopy;

const clockOutRejectedCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.clockOutRejected.title",
		titleDefault: "Clock-out rejected",
		messageKey: "common:notifications.content.clockOutRejected.message",
		messageDefault:
			"Your clock-out approval was rejected by {approverName}. The recorded times remain unchanged and are excluded from approved payroll time.",
	},
	withReason: {
		titleKey: "common:notifications.content.clockOutRejected.title",
		titleDefault: "Clock-out rejected",
		messageKey: "common:notifications.content.clockOutRejected.messageWithReason",
		messageDefault:
			"Your clock-out approval was rejected by {approverName}. The recorded times remain unchanged and are excluded from approved payroll time. Reason: {rejectionReason}",
	},
} as const satisfies Record<string, NotificationCopy>;

const manualEntryApprovedCopy = {
	titleKey: "common:notifications.content.manualEntryApproved.title",
	titleDefault: "Manual time submission approved",
	messageKey: "common:notifications.content.manualEntryApproved.message",
	messageDefault: "Your manual time submission was approved by {approverName}.",
} as const satisfies NotificationCopy;

const manualEntryRejectedCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.manualEntryRejected.title",
		titleDefault: "Manual time submission rejected",
		messageKey: "common:notifications.content.manualEntryRejected.message",
		messageDefault: "Your manual time submission was rejected by {approverName}.",
	},
	withReason: {
		titleKey: "common:notifications.content.manualEntryRejected.title",
		titleDefault: "Manual time submission rejected",
		messageKey: "common:notifications.content.manualEntryRejected.messageWithReason",
		messageDefault:
			"Your manual time submission was rejected by {approverName}. Reason: {rejectionReason}",
	},
} as const satisfies Record<string, NotificationCopy>;

/** A decision's params: the approver, and the reason of a rejection. */
function clockOutDecisionParams(params: ClockOutApprovalResultParams) {
	return {
		approverName: params.approverName,
		...(params.rejectionReason ? { rejectionReason: params.rejectionReason } : {}),
	};
}

/** Creates the notification; a durable one fails its caller instead of being dropped. */
async function createClockOutNotification(
	notification: CreateNotificationParams,
	durable: boolean | undefined,
) {
	if (durable) {
		await createNotification(notification, { throwOnError: true });
	} else {
		await createNotification(notification);
	}
}

interface ClockOutApprovalResultParams {
	workPeriodId: string;
	employeeUserId: string;
	organizationId: string;
	approverName: string;
	startTime: Date;
	endTime: Date;
	rejectionReason?: string;
	idempotencyKey?: string;
	durable?: boolean;
}

/**
 * Notify employee that their submitted work is pending approval. Manual time
 * entries use it; a live clock-out never routes approval (#361).
 */
export async function onClockOutPendingApproval(
	params: ClockOutApprovalParams,
): Promise<void> {
	try {
		const duration = notificationParam.duration(params.durationMinutes);
		// The work's day at its clock-in entry's offset (O11), never the server's zone.
		const content = params.times
			? translatedContent(clockOutPendingApprovalCopy.withDate, {
					date: entryTimeParam(params.times.clockIn, "dateMedium"),
					duration,
				})
			: translatedContent(clockOutPendingApprovalCopy.withoutDate, { duration });
		await createClockOutNotification(
			{
				userId: params.employeeUserId,
				organizationId: params.organizationId,
				type: "time_correction_submitted",
				title: content.title,
				message: content.message,
				entityType: "work_period",
				entityId: params.workPeriodId,
				actionUrl: "/time-tracking",
				metadata: { i18n: content.i18n },
				...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
			},
			params.durable,
		);
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger clock-out pending notification",
		);
		if (params.durable) throw error;
	}
}

/**
 * Notify manager that submitted work needs approval (manual time entries).
 */
export async function onClockOutPendingApprovalToManager(
	params: ClockOutApprovalToManagerParams,
): Promise<void> {
	try {
		const duration = notificationParam.duration(params.durationMinutes);
		const { times } = params;
		// Each time at its own entry's offset (O11), never the server's zone.
		const content = times?.clockOut
			? translatedContent(clockOutApprovalRequiredCopy.withTimes, {
					employeeName: params.employeeName,
					date: entryTimeParam(times.clockIn, "dateMedium"),
					startTime: entryTimeParam(times.clockIn, "time"),
					endTime: entryTimeParam(times.clockOut, "time"),
					duration,
				})
			: translatedContent(clockOutApprovalRequiredCopy.withoutTimes, {
					employeeName: params.employeeName,
					duration,
				});
		await createClockOutNotification(
			{
				userId: params.managerUserId,
				organizationId: params.organizationId,
				type: "approval_request_submitted",
				title: content.title,
				message: content.message,
				entityType: "work_period",
				entityId: params.workPeriodId,
				actionUrl: "/approvals/inbox",
				metadata: { i18n: content.i18n },
				...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
			},
			params.durable,
		);
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger clock-out approval manager notification",
		);
		if (params.durable) throw error;
	}
}

/**
 * Notify employee that their clock-out was approved
 */
export async function onClockOutApproved(
	params: ClockOutApprovalResultParams,
): Promise<void> {
	try {
		const content = translatedContent(clockOutApprovedCopy, clockOutDecisionParams(params));
		await createClockOutNotification(
			{
				userId: params.employeeUserId,
				organizationId: params.organizationId,
				type: "time_correction_approved",
				title: content.title,
				message: content.message,
				entityType: "work_period",
				entityId: params.workPeriodId,
				actionUrl: "/time-tracking",
				metadata: { i18n: content.i18n },
				...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
			},
			params.durable,
		);
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger clock-out approved notification",
		);
		if (params.durable) throw error;
	}
}

/**
 * Notify employee that their clock-out was rejected
 */
export async function onClockOutRejected(
	params: ClockOutApprovalResultParams,
): Promise<void> {
	try {
		const content = translatedContent(
			params.rejectionReason ? clockOutRejectedCopy.withReason : clockOutRejectedCopy.withoutReason,
			clockOutDecisionParams(params),
		);

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_rejected",
			title: content.title,
			message: content.message,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger clock-out rejected notification",
		);
	}
}

export async function onManualEntryApproved(
	params: ClockOutApprovalResultParams,
): Promise<void> {
	try {
		const content = translatedContent(manualEntryApprovedCopy, clockOutDecisionParams(params));
		await createClockOutNotification(
			{
				userId: params.employeeUserId,
				organizationId: params.organizationId,
				type: "time_correction_approved",
				title: content.title,
				message: content.message,
				entityType: "work_period",
				entityId: params.workPeriodId,
				actionUrl: "/time-tracking",
				metadata: { i18n: content.i18n },
				...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
			},
			params.durable,
		);
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger manual time approval notification",
		);
		if (params.durable) throw error;
	}
}

export async function onManualEntryRejected(
	params: ClockOutApprovalResultParams,
): Promise<void> {
	try {
		const content = translatedContent(
			params.rejectionReason
				? manualEntryRejectedCopy.withReason
				: manualEntryRejectedCopy.withoutReason,
			clockOutDecisionParams(params),
		);
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_rejected",
			title: content.title,
			message: content.message,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger manual time rejection notification",
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
		// The corrected times are what the email channel sends (#1137).
		const content = translatedContent(timeCorrectionApprovedCopy, {
			approverName: params.approverName,
			...correctedTimeParams(params.corrected),
		});
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_approved",
			title: content.title,
			message: content.message,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger time correction approved notification",
		);
	}
}

/**
 * Notify employee that their time correction was rejected
 */
export async function onTimeCorrectionRejected(
	params: TimeCorrectionRejectionParams,
): Promise<void> {
	try {
		const content = translatedContent(
			params.rejectionReason
				? timeCorrectionRejectedCopy.withReason
				: timeCorrectionRejectedCopy.withoutReason,
			{
				approverName: params.approverName,
				...correctedTimeParams(params.corrected),
				...(params.rejectionReason ? { rejectionReason: params.rejectionReason } : {}),
			},
		);

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "time_correction_rejected",
			title: content.title,
			message: content.message,
			entityType: "work_period",
			entityId: params.workPeriodId,
			actionUrl: "/time-tracking",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger time correction rejected notification",
		);
	}
}

interface TravelExpenseDecisionParams {
	claimId: string;
	requesterUserId: string;
	organizationId: string;
	approverName: string;
	destinationCity: string | null;
	amount: string;
	currency: string;
}

interface TravelExpenseRejectionParams extends TravelExpenseDecisionParams {
	rejectionReason?: string;
}

const travelExpenseApprovedCopy = {
	withDestination: {
		titleKey: "common:notifications.content.travelExpenseApproved.title",
		titleDefault: "Travel expense approved",
		messageKey: "common:notifications.content.travelExpenseApproved.message",
		messageDefault:
			"Your travel expense claim for {destination} ({amount}) was approved by {approverName}.",
	},
	withoutDestination: {
		titleKey: "common:notifications.content.travelExpenseApproved.title",
		titleDefault: "Travel expense approved",
		messageKey: "common:notifications.content.travelExpenseApproved.messageWithoutDestination",
		messageDefault: "Your travel expense claim for {amount} was approved by {approverName}.",
	},
} as const satisfies Record<string, NotificationCopy>;

const travelExpenseRejectedCopy = {
	withDestination: {
		titleKey: "common:notifications.content.travelExpenseRejected.title",
		titleDefault: "Travel expense rejected",
		messageKey: "common:notifications.content.travelExpenseRejected.message",
		messageDefault:
			"Your travel expense claim for {destination} ({amount}) was rejected by {approverName}.",
	},
	withDestinationAndReason: {
		titleKey: "common:notifications.content.travelExpenseRejected.title",
		titleDefault: "Travel expense rejected",
		messageKey: "common:notifications.content.travelExpenseRejected.messageWithReason",
		messageDefault:
			"Your travel expense claim for {destination} ({amount}) was rejected by {approverName}. Reason: {reason}",
	},
	withoutDestination: {
		titleKey: "common:notifications.content.travelExpenseRejected.title",
		titleDefault: "Travel expense rejected",
		messageKey: "common:notifications.content.travelExpenseRejected.messageWithoutDestination",
		messageDefault: "Your travel expense claim for {amount} was rejected by {approverName}.",
	},
	withoutDestinationWithReason: {
		titleKey: "common:notifications.content.travelExpenseRejected.title",
		titleDefault: "Travel expense rejected",
		messageKey:
			"common:notifications.content.travelExpenseRejected.messageWithoutDestinationWithReason",
		messageDefault:
			"Your travel expense claim for {amount} was rejected by {approverName}. Reason: {reason}",
	},
} as const satisfies Record<string, NotificationCopy>;

const travelExpenseReportDecidedCopy = {
	approved: {
		titleKey: "common:notifications.content.travelExpenseReportApproved.title",
		titleDefault: "Expense report approved",
		messageKey: "common:notifications.content.travelExpenseReportApproved.message",
		messageDefault: "Your expense report (reimbursable {amount}) was approved by {approverName}.",
	},
	rejected: {
		titleKey: "common:notifications.content.travelExpenseReportRejected.title",
		titleDefault: "Expense report rejected",
		messageKey: "common:notifications.content.travelExpenseReportRejected.message",
		messageDefault: "Your expense report (reimbursable {amount}) was rejected by {approverName}.",
	},
	rejectedWithReason: {
		titleKey: "common:notifications.content.travelExpenseReportRejected.title",
		titleDefault: "Expense report rejected",
		messageKey: "common:notifications.content.travelExpenseReportRejected.messageWithReason",
		messageDefault:
			"Your expense report (reimbursable {amount}) was rejected by {approverName}. Reason: {reason}",
	},
} as const satisfies Record<string, NotificationCopy>;

const travelExpenseReportReturnedCopy = {
	titleKey: "common:notifications.content.travelExpenseReportReturned.title",
	titleDefault: "Expense report returned for changes",
	messageKey: "common:notifications.content.travelExpenseReportReturned.message",
	messageDefault: "{reviewerName} returned your expense report for changes: {note}",
} as const satisfies NotificationCopy;

/** The claim's destination (when known), amount, approver and reason as params. */
function travelExpenseDecisionParams(
	params: TravelExpenseRejectionParams,
): Record<string, NotificationParamValue> {
	return {
		...(params.destinationCity ? { destination: params.destinationCity } : {}),
		amount: notificationParam.money(params.amount, params.currency),
		approverName: params.approverName,
		...(params.rejectionReason ? { reason: params.rejectionReason } : {}),
	};
}

/**
 * Notify requester that their travel expense claim was approved.
 */
export async function onTravelExpenseApproved(
	params: TravelExpenseDecisionParams,
): Promise<void> {
	try {
		const copy = params.destinationCity
			? travelExpenseApprovedCopy.withDestination
			: travelExpenseApprovedCopy.withoutDestination;
		const i18nParams = travelExpenseDecisionParams(params);

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "approval_request_approved",
			title: content.title,
			message: content.message,
			entityType: "travel_expense_claim",
			entityId: params.claimId,
			actionUrl: "/travel-expenses",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger travel expense approved notification",
		);
	}
}

/**
 * Notify requester that their travel expense claim was rejected.
 */
export async function onTravelExpenseRejected(
	params: TravelExpenseRejectionParams,
): Promise<void> {
	try {
		const copy = params.destinationCity
			? params.rejectionReason
				? travelExpenseRejectedCopy.withDestinationAndReason
				: travelExpenseRejectedCopy.withDestination
			: params.rejectionReason
				? travelExpenseRejectedCopy.withoutDestinationWithReason
				: travelExpenseRejectedCopy.withoutDestination;
		const i18nParams = travelExpenseDecisionParams(params);

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "approval_request_rejected",
			title: content.title,
			message: content.message,
			entityType: "travel_expense_claim",
			entityId: params.claimId,
			actionUrl: "/travel-expenses",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger travel expense rejected notification",
		);
	}
}

/**
 * Notify the employee that a reviewer decided their whole expense report (#602).
 */
export async function onTravelExpenseReportDecided(params: {
	reportId: string;
	requesterUserId: string;
	organizationId: string;
	approverName: string;
	action: "approve" | "reject";
	/** Employee-paid total of the decided revision, possibly zero. */
	reimbursable: string;
	currency: string;
	rejectionReason?: string;
}): Promise<void> {
	try {
		const approved = params.action === "approve";
		const reason = approved ? undefined : params.rejectionReason;
		const copy = approved
			? travelExpenseReportDecidedCopy.approved
			: reason
				? travelExpenseReportDecidedCopy.rejectedWithReason
				: travelExpenseReportDecidedCopy.rejected;
		const i18nParams: Record<string, NotificationParamValue> = {
			amount: notificationParam.money(params.reimbursable, params.currency),
			approverName: params.approverName,
			...(reason ? { reason } : {}),
		};
		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: approved ? "approval_request_approved" : "approval_request_rejected",
			title: content.title,
			message: content.message,
			entityType: "travel_expense_report",
			entityId: params.reportId,
			actionUrl: `/travel-expenses/reports/${params.reportId}`,
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger expense report decision notification");
	}
}

/**
 * Notify the employee that a reviewer returned their expense report for
 * changes (#603); the report is editable again and can be resubmitted.
 */
export async function onTravelExpenseReportReturned(params: {
	reportId: string;
	requesterUserId: string;
	organizationId: string;
	reviewerName: string;
	note: string;
}): Promise<void> {
	try {
		const copy = travelExpenseReportReturnedCopy;
		const i18nParams = { reviewerName: params.reviewerName, note: params.note };
		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "approval_request_rejected",
			title: content.title,
			message: content.message,
			entityType: "travel_expense_report",
			entityId: params.reportId,
			actionUrl: `/travel-expenses/reports/${params.reportId}`,
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger expense report return notification");
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
export async function onTeamMemberAdded(
	params: TeamMemberParams,
): Promise<void> {
	try {
		const content = translatedContent(notificationCopy.teamMemberAdded, {
			teamName: params.teamName,
			performedByName: params.performedByName,
		});

		await createNotification({
			userId: params.memberUserId,
			organizationId: params.organizationId,
			type: "team_member_added",
			title: content.title,
			message: content.message,
			entityType: "team",
			entityId: params.teamId,
			actionUrl: "/team",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger team member added notification",
		);
	}
}

/**
 * Notify user they were removed from a team
 */
export async function onTeamMemberRemoved(
	params: TeamMemberParams,
): Promise<void> {
	try {
		const content = translatedContent(notificationCopy.teamMemberRemoved, {
			teamName: params.teamName,
			performedByName: params.performedByName,
		});

		await createNotification({
			userId: params.memberUserId,
			organizationId: params.organizationId,
			type: "team_member_removed",
			title: content.title,
			message: content.message,
			entityType: "team",
			entityId: params.teamId,
			actionUrl: "/team",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger team member removed notification",
		);
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
		const content = translatedContent(notificationCopy.passwordChanged, {});

		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "password_changed",
			title: content.title,
			message: content.message,
			actionUrl: "/settings/security",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger password changed notification",
		);
	}
}

const twoFactorEnabledCopy = {
	titleKey: "common:notifications.content.twoFactorEnabled.title",
	titleDefault: "Two-factor authentication enabled",
	messageKey: "common:notifications.content.twoFactorEnabled.message",
	messageDefault:
		"Two-factor authentication has been enabled on your account for added security.",
} as const satisfies NotificationCopy;

const twoFactorDisabledCopy = {
	titleKey: "common:notifications.content.twoFactorDisabled.title",
	titleDefault: "Two-factor authentication disabled",
	messageKey: "common:notifications.content.twoFactorDisabled.message",
	messageDefault:
		"Two-factor authentication has been disabled on your account. We recommend re-enabling it for security.",
} as const satisfies NotificationCopy;

/**
 * Notify user 2FA was enabled
 */
export async function onTwoFactorEnabled(
	params: SecurityParams,
): Promise<void> {
	try {
		const content = translatedContent(twoFactorEnabledCopy, {});

		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "two_factor_enabled",
			title: content.title,
			message: content.message,
			actionUrl: "/settings/security",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger 2FA enabled notification",
		);
	}
}

/**
 * Notify user 2FA was disabled
 */
export async function onTwoFactorDisabled(
	params: SecurityParams,
): Promise<void> {
	try {
		const content = translatedContent(twoFactorDisabledCopy, {});

		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "two_factor_disabled",
			title: content.title,
			message: content.message,
			actionUrl: "/settings/security",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger 2FA disabled notification",
		);
	}
}

// =============================================================================
// Reminder Notifications
// =============================================================================

interface BirthdayReminderParams {
	userId: string;
	organizationId: string;
	birthdayPersonName: string;
	/** The birthday's calendar day this year. */
	birthdayDate: PlainDate;
}

const birthdayReminderCopy = {
	titleKey: "common:notifications.content.birthdayReminder.title",
	titleDefault: "Upcoming birthday",
	messageKey: "common:notifications.content.birthdayReminder.message",
	messageDefault: "{name}'s birthday is on {date}.",
} as const satisfies NotificationCopy;

/**
 * Notify user about an upcoming birthday
 */
export async function onBirthdayReminder(
	params: BirthdayReminderParams,
): Promise<void> {
	try {
		const copy = birthdayReminderCopy;
		const i18nParams = {
			name: params.birthdayPersonName,
			date: notificationParam.plainDate(params.birthdayDate, "monthDayLong"),
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "birthday_reminder",
			title: content.title,
			message: content.message,
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger birthday reminder notification",
		);
	}
}

interface VacationBalanceAlertParams {
	userId: string;
	organizationId: string;
	remainingDays: number;
	/** The calendar day the remaining days expire. */
	expiryDate?: PlainDate;
}

const vacationBalanceCopy = {
	remaining: {
		titleKey: "common:notifications.content.vacationBalanceAlert.title",
		titleDefault: "Vacation balance reminder",
		messageKey: "common:notifications.content.vacationBalanceAlert.message",
		messageDefault:
			"You have {remainingDays, plural, one {# vacation day} other {# vacation days}} remaining. Don't forget to take some time off!",
	},
	expiring: {
		titleKey: "common:notifications.content.vacationBalanceAlert.title",
		titleDefault: "Vacation balance reminder",
		messageKey: "common:notifications.content.vacationBalanceAlert.expiringMessage",
		messageDefault:
			"You have {remainingDays, plural, one {# vacation day} other {# vacation days}} expiring on {expiryDate}. Use them before they expire!",
	},
} as const satisfies Record<string, NotificationCopy>;

/**
 * Notify user about low vacation balance or expiring days
 */
export async function onVacationBalanceAlert(
	params: VacationBalanceAlertParams,
): Promise<void> {
	try {
		const copy = params.expiryDate ? vacationBalanceCopy.expiring : vacationBalanceCopy.remaining;
		const i18nParams = {
			remainingDays: params.remainingDays,
			...(params.expiryDate
				? { expiryDate: notificationParam.plainDate(params.expiryDate, "monthDay") }
				: {}),
		};
		// The stored English fallback; the ICU plural is rendered per recipient on delivery.
		const days = `${params.remainingDays} vacation day${params.remainingDays === 1 ? "" : "s"}`;
		const message = params.expiryDate
			? fillNotificationTemplate(
					"You have {days} expiring on {expiryDate}. Use them before they expire!",
					{ ...i18nParams, days },
				)
			: `You have ${days} remaining. Don't forget to take some time off!`;

		await createNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			type: "vacation_balance_alert",
			title: copy.titleDefault,
			message,
			actionUrl: "/absences",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger vacation balance alert notification",
		);
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
	/** The published schedule's first and last calendar days. */
	dateRange: { start: PlainDate; end: PlainDate };
}

interface ShiftAssignedParams {
	shiftId: string;
	employeeUserId: string;
	organizationId: string;
	shiftDate: PlainDate;
	startTime: string;
	endTime: string;
	assignedByName: string;
}

interface ShiftSwapRequestParams {
	requestId: string;
	shiftId: string;
	organizationId: string;
	requesterName: string;
	shiftDate: PlainDate;
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
	shiftDate: PlainDate;
}

interface ShiftSwapRejectionParams extends ShiftSwapApprovalParams {
	rejectionReason?: string;
}

interface ShiftPickupParams {
	shiftId: string;
	organizationId: string;
	shiftDate: PlainDate;
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
	shiftDate: PlainDate;
	approverName: string;
}

const schedulePublishedCopy = {
	titleKey: "common:notifications.content.schedulePublished.title",
	titleDefault: "New schedule published",
	messageKey: "common:notifications.content.schedulePublished.message",
	messageDefault:
		"{shiftCount, plural, one {# shift has} other {# shifts have}} been published for {dateRange}.",
} as const satisfies NotificationCopy;

const shiftSwapRequestedToManagerCopy = {
	withoutTarget: {
		titleKey: "common:notifications.content.shiftSwapRequestedToManager.title",
		titleDefault: "Shift swap request",
		messageKey: "common:notifications.content.shiftSwapRequestedToManager.message",
		messageDefault:
			"{requesterName} requested a swap for the shift on {shiftDate} ({startTime} - {endTime}).",
	},
	withTarget: {
		titleKey: "common:notifications.content.shiftSwapRequestedToManager.title",
		titleDefault: "Shift swap request",
		messageKey: "common:notifications.content.shiftSwapRequestedToManager.messageWithTarget",
		messageDefault:
			"{requesterName} requested to swap with {targetName} for the shift on {shiftDate} ({startTime} - {endTime}).",
	},
} as const satisfies Record<string, NotificationCopy>;

const shiftSwapRequestedToTargetCopy = {
	titleKey: "common:notifications.content.shiftSwapRequestedToTarget.title",
	titleDefault: "Shift swap request",
	messageKey: "common:notifications.content.shiftSwapRequestedToTarget.message",
	messageDefault:
		"{requesterName} wants to swap shifts with you for {shiftDate} ({startTime} - {endTime}).",
} as const satisfies NotificationCopy;

const shiftSwapApprovedCopy = {
	titleKey: "common:notifications.content.shiftSwapApproved.title",
	titleDefault: "Shift swap approved",
	messageKey: "common:notifications.content.shiftSwapApproved.message",
	messageDefault: "Your shift swap request for {shiftDate} was approved by {approverName}.",
} as const satisfies NotificationCopy;

const shiftSwapRejectedCopy = {
	withoutReason: {
		titleKey: "common:notifications.content.shiftSwapRejected.title",
		titleDefault: "Shift swap rejected",
		messageKey: "common:notifications.content.shiftSwapRejected.message",
		messageDefault: "Your shift swap request for {shiftDate} was rejected by {approverName}.",
	},
	withReason: {
		titleKey: "common:notifications.content.shiftSwapRejected.title",
		titleDefault: "Shift swap rejected",
		messageKey: "common:notifications.content.shiftSwapRejected.messageWithReason",
		messageDefault:
			"Your shift swap request for {shiftDate} was rejected by {approverName}. Reason: {reason}",
	},
} as const satisfies Record<string, NotificationCopy>;

const openShiftAvailableCopy = {
	titleKey: "common:notifications.content.openShiftAvailable.title",
	titleDefault: "Open shift available",
	messageKey: "common:notifications.content.openShiftAvailable.message",
	messageDefault: "An open shift is available on {shiftDate} from {startTime} to {endTime}.",
} as const satisfies NotificationCopy;

const shiftPickupApprovedCopy = {
	titleKey: "common:notifications.content.shiftPickupApproved.title",
	titleDefault: "Shift pickup approved",
	messageKey: "common:notifications.content.shiftPickupApproved.message",
	messageDefault:
		"Your request to pick up the shift on {shiftDate} was approved by {approverName}.",
} as const satisfies NotificationCopy;

/** A shift's organization-local calendar day, formatted per recipient. */
function shiftDateParam(date: PlainDate): NotificationParamValue {
	return notificationParam.plainDate(date, "weekdayMonthDay");
}

/**
 * Notify employee that their schedule was published (batched per employee)
 */
export async function onSchedulePublished(
	params: SchedulePublishedParams,
): Promise<void> {
	try {
		const copy = schedulePublishedCopy;
		const i18nParams = {
			shiftCount: params.shiftCount,
			dateRange: notificationParam.plainDateRange(params.dateRange.start, params.dateRange.end),
		};
		// The stored English fallback; the ICU plural is rendered per recipient on delivery.
		const shifts = params.shiftCount === 1 ? "1 shift has" : `${params.shiftCount} shifts have`;

		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "schedule_published",
			title: copy.titleDefault,
			message: fillNotificationTemplate("{shifts} been published for {dateRange}.", {
				...i18nParams,
				shifts,
			}),
			actionUrl: "/scheduling",
			metadata: { i18n: translatedContent(copy, i18nParams).i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger schedule published notification",
		);
	}
}

/**
 * Notify employee they were assigned to a shift
 */
export async function onShiftAssigned(
	params: ShiftAssignedParams,
): Promise<void> {
	try {
		const copy = notificationCopy.shiftAssigned;
		const i18nParams = {
			shiftDate: shiftDateParam(params.shiftDate),
			startTime: params.startTime,
			endTime: params.endTime,
			assignedByName: params.assignedByName,
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "shift_assigned",
			title: content.title,
			message: content.message,
			entityType: "shift",
			entityId: params.shiftId,
			actionUrl: "/scheduling",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger shift assigned notification",
		);
	}
}

/**
 * Notify manager about a shift swap request
 */
export async function onShiftSwapRequestedToManager(
	params: ShiftSwapRequestToManagerParams,
): Promise<void> {
	try {
		const copy = params.targetEmployeeName
			? shiftSwapRequestedToManagerCopy.withTarget
			: shiftSwapRequestedToManagerCopy.withoutTarget;
		const i18nParams = {
			requesterName: params.requesterName,
			...(params.targetEmployeeName ? { targetName: params.targetEmployeeName } : {}),
			shiftDate: shiftDateParam(params.shiftDate),
			startTime: params.startTime,
			endTime: params.endTime,
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "shift_swap_requested",
			title: content.title,
			message: content.message,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/approvals/inbox",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger shift swap request manager notification",
		);
	}
}

/**
 * Notify target employee about a shift swap request directed at them
 */
export async function onShiftSwapRequestedToTarget(
	params: ShiftSwapRequestToTargetParams,
): Promise<void> {
	try {
		const copy = shiftSwapRequestedToTargetCopy;
		const i18nParams = {
			requesterName: params.requesterName,
			shiftDate: shiftDateParam(params.shiftDate),
			startTime: params.startTime,
			endTime: params.endTime,
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.targetEmployeeUserId,
			organizationId: params.organizationId,
			type: "shift_swap_requested",
			title: content.title,
			message: content.message,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/scheduling",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger shift swap request target notification",
		);
	}
}

/**
 * Notify requester their shift swap was approved
 */
export async function onShiftSwapApproved(
	params: ShiftSwapApprovalParams,
): Promise<void> {
	try {
		const copy = shiftSwapApprovedCopy;
		const i18nParams = {
			shiftDate: shiftDateParam(params.shiftDate),
			approverName: params.approverName,
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "shift_swap_approved",
			title: content.title,
			message: content.message,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/scheduling",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger shift swap approved notification",
		);
	}
}

/**
 * Notify requester their shift swap was rejected
 */
export async function onShiftSwapRejected(
	params: ShiftSwapRejectionParams,
): Promise<void> {
	try {
		const copy = params.rejectionReason
			? shiftSwapRejectedCopy.withReason
			: shiftSwapRejectedCopy.withoutReason;
		const i18nParams = {
			shiftDate: shiftDateParam(params.shiftDate),
			approverName: params.approverName,
			...(params.rejectionReason ? { reason: params.rejectionReason } : {}),
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "shift_swap_rejected",
			title: content.title,
			message: content.message,
			entityType: "shift_request",
			entityId: params.requestId,
			actionUrl: "/scheduling",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger shift swap rejected notification",
		);
	}
}

/**
 * Notify team members about an open shift available for pickup
 */
export async function onOpenShiftAvailable(
	params: OpenShiftAvailableParams,
): Promise<void> {
	try {
		const copy = openShiftAvailableCopy;
		const i18nParams = {
			shiftDate: shiftDateParam(params.shiftDate),
			startTime: params.startTime,
			endTime: params.endTime,
		};
		const content = translatedContent(copy, i18nParams);
		// Create notifications for all eligible team members
		await Promise.all(
			params.teamMemberUserIds.map((userId) =>
				createNotification({
					userId,
					organizationId: params.organizationId,
					type: "shift_pickup_available",
					title: content.title,
					message: content.message,
					entityType: "shift",
					entityId: params.shiftId,
					actionUrl: "/scheduling",
					metadata: { i18n: content.i18n },
				}),
			),
		);
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger open shift available notification",
		);
	}
}

/**
 * Notify employee their shift pickup was approved
 */
export async function onShiftPickupApproved(
	params: ShiftPickupApprovedParams,
): Promise<void> {
	try {
		const copy = shiftPickupApprovedCopy;
		const i18nParams = {
			shiftDate: shiftDateParam(params.shiftDate),
			approverName: params.approverName,
		};

		const content = translatedContent(copy, i18nParams);
		await createNotification({
			userId: params.employeeUserId,
			organizationId: params.organizationId,
			type: "shift_pickup_approved",
			title: content.title,
			message: content.message,
			entityType: "shift",
			entityId: params.shiftId,
			actionUrl: "/scheduling",
			metadata: { i18n: content.i18n },
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to trigger shift pickup approved notification",
		);
	}
}
