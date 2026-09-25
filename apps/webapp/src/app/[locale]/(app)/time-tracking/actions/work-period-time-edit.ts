"use server";

import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import {
	approvalRequest,
	approvalWorkflow,
	employee,
	workPeriod,
} from "@/db/schema";
import {
	editSameDayTimeEntry,
	requestTimeCorrectionEffect,
} from "@/lib/approvals/server/time-correction-submission";
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import { resolveManualWallClock } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	applyAdminWorkPeriodTimeEdit,
	replayAdminWorkPeriodTimeEdit,
} from "@/lib/time-tracking/admin-work-period-time-edit";
import { describeAmendmentFailure } from "@/lib/time-tracking/amend-completed-work";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { normalizeWorkLocationType } from "@/lib/time-tracking/work-location";
import {
	haveWorkPeriodDatesChanged,
	haveWorkPeriodTimesChanged,
	resolveWorkPeriodTimeEditAccess,
	resolveWorkPeriodTimeEditRoute,
	type WorkPeriodTimeEditAccess,
	type WorkPeriodTimeEditValues,
} from "@/lib/time-tracking/work-period-time-edit-policy";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
	getCurrentEmployee,
	getCurrentSession,
	getRequestMetadata,
	getUserTimezone,
} from "./auth";
import { getEditCapabilityForPeriod } from "./policy-helpers";
import { logger } from "./shared";

export interface WorkPeriodTimeEditContext {
	access: WorkPeriodTimeEditAccess;
	/** Timezone the wall-clock values are shown in and interpreted in. */
	timezone: string;
	values: WorkPeriodTimeEditValues;
}

export interface UpdateWorkPeriodTimesInput extends WorkPeriodTimeEditValues {
	workPeriodId: string;
	submissionId: string;
	reason: string;
}

const workPeriodIdSchema = z.uuid();
const updateWorkPeriodTimesSchema = z.object({
	workPeriodId: z.uuid(),
	submissionId: z.uuid(),
	clockInDate: z.iso.date(),
	clockInTime: z.string().regex(/^\d{2}:\d{2}$/),
	clockOutDate: z.iso.date(),
	clockOutTime: z.string().regex(/^\d{2}:\d{2}$/),
	reason: z.string().max(2000),
});
const DEFAULT_DIRECT_EDIT_NOTE = "Edited in calendar";

type LoadedTimeEditTarget = {
	userId: string;
	organizationId: string;
	period: typeof workPeriod.$inferSelect;
	isOwnEntry: boolean;
	context: WorkPeriodTimeEditContext;
};

function blockedAccessError(
	access: Extract<WorkPeriodTimeEditAccess, { kind: "blocked" }>,
): { success: false; error: string; code: string } {
	switch (access.reason) {
		case "not_owner":
			return {
				success: false,
				error: "You can only edit your own time entries",
				code: access.reason,
			};
		case "running":
			return {
				success: false,
				error: "Cannot edit an active work period. Please clock out first.",
				code: access.reason,
			};
		case "pending_correction":
			return {
				success: false,
				error:
					"A time correction approval is already pending for this work period",
				code: "pending_time_correction_approval",
			};
		case "pending_approval":
			return {
				success: false,
				error: "This work period is awaiting approval and cannot be edited",
				code: access.reason,
			};
		case "beyond_approval_window":
			return {
				success: false,
				error: `Entries older than ${access.daysBack} days can only be edited by organization admins.`,
				code: access.reason,
			};
	}
}

async function hasPendingTimeCorrection(
	organizationId: string,
	workPeriodId: string,
): Promise<boolean> {
	const [legacyPending, canonicalPending] = await Promise.all([
		db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, workPeriodId),
				eq(approvalRequest.status, "pending"),
			),
			columns: { id: true },
		}),
		db.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.organizationId, organizationId),
				eq(approvalWorkflow.workflowType, "time_correction"),
				eq(approvalWorkflow.sourceType, "time_entry"),
				eq(approvalWorkflow.sourceId, workPeriodId),
				eq(approvalWorkflow.status, "pending"),
			),
			columns: { id: true },
		}),
	]);
	return Boolean(legacyPending || canonicalPending);
}

async function loadTimeEditTarget(
	workPeriodId: string,
): Promise<
	| { success: true; target: LoadedTimeEditTarget }
	| { success: false; error: string; code?: string }
> {
	if (!workPeriodIdSchema.safeParse(workPeriodId).success) {
		return { success: false, error: "Work period not found" };
	}
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	const organizationId = currentEmployee.organizationId;

	const [period] = await db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period) {
		return { success: false, error: "Work period not found" };
	}

	const isOwnEntry = period.employeeId === currentEmployee.id;
	const isOrgAdmin = await isOrgAdminCasl(organizationId);
	if (!isOwnEntry && !isOrgAdmin) {
		return blockedAccessError({ kind: "blocked", reason: "not_owner" });
	}

	let ownerUserId = session.user.id;
	if (!isOwnEntry) {
		const owner = await db.query.employee.findFirst({
			where: and(
				eq(employee.id, period.employeeId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
			),
			columns: { userId: true },
		});
		if (!owner) {
			return { success: false, error: "Work period not found" };
		}
		ownerUserId = owner.userId;
	}

	// Wall-clock values always use the entry owner's timezone, never the viewer's.
	const [timezone, pendingCorrection] = await Promise.all([
		getUserTimezone(ownerUserId),
		hasPendingTimeCorrection(organizationId, period.id),
	]);

	let capability: Awaited<
		ReturnType<typeof getEditCapabilityForPeriod>
	> | null = null;
	if (!isOrgAdmin && period.endTime) {
		try {
			capability = await getEditCapabilityForPeriod({
				employeeId: currentEmployee.id,
				workPeriodEndTime: period.endTime,
				timezone,
			});
		} catch (error) {
			logger.error({ error }, "Failed to resolve work period edit capability");
			return {
				success: false,
				error: "Failed to verify edit policy. Please try again.",
			};
		}
	}

	const access = resolveWorkPeriodTimeEditAccess({
		isOrgAdmin,
		isOwnEntry,
		isCompleted: Boolean(period.endTime && period.clockOutId),
		approvalStatus: period.approvalStatus ?? null,
		hasPendingCorrection: pendingCorrection,
		capability,
	});
	const clockIn = getInstantLocalMinuteFields(
		instantFromDate(period.startTime),
		timezone,
	);
	const clockOut = period.endTime
		? getInstantLocalMinuteFields(instantFromDate(period.endTime), timezone)
		: { date: "", time: "" };

	return {
		success: true,
		target: {
			userId: session.user.id,
			organizationId,
			period,
			isOwnEntry,
			context: {
				access,
				timezone,
				values: {
					clockInDate: clockIn.date,
					clockInTime: clockIn.time,
					clockOutDate: clockOut.date,
					clockOutTime: clockOut.time,
				},
			},
		},
	};
}

/**
 * Resolves whether the current user may edit the times of a work period and how
 * the change will be applied (directly or through approval).
 */
export async function getWorkPeriodTimeEditContext(
	workPeriodId: string,
): Promise<ServerActionResult<WorkPeriodTimeEditContext>> {
	const loaded = await loadTimeEditTarget(workPeriodId);
	if (!loaded.success) {
		return loaded;
	}
	return { success: true, data: loaded.target.context };
}

function parseWallClock(date: string, time: string, timezone: string): Date {
	try {
		return dateFromInstant(
			resolveManualWallClock({
				date,
				time,
				timezone,
				disambiguation: "earlier",
			}).toInstant(),
		);
	} catch {
		throw new ValidationError({
			message: "Invalid date or time",
			field: "timestamp",
		});
	}
}

async function applyAdminEdit(
	target: LoadedTimeEditTarget,
	input: UpdateWorkPeriodTimesInput,
	reason: string,
): Promise<ServerActionResult<{ status: "applied" | "pending" }>> {
	const { period, organizationId, context } = target;
	const submitted = {
		clockInDate: input.clockInDate,
		clockInTime: input.clockInTime,
		clockOutDate: input.clockOutDate,
		clockOutTime: input.clockOutTime,
	};
	const notes = reason || DEFAULT_DIRECT_EDIT_NOTE;
	try {
		// A committed adopted edit replays before fresh checks, which its own
		// result may have changed.
		if (
			await replayAdminWorkPeriodTimeEdit({
				organizationId,
				actorUserId: target.userId,
				submissionId: input.submissionId,
				workPeriodId: period.id,
				submitted,
				notes,
			})
		) {
			return { success: true, data: { status: "applied" } };
		}
	} catch (error) {
		const failure = describeAmendmentFailure(error);
		if (failure)
			return { success: false, error: failure.message, code: failure.code };
		logger.error({ error }, "Failed to replay admin work period time edit");
		return {
			success: false,
			error: "Failed to update time entry. Please try again.",
		};
	}
	if (!period.endTime || !period.clockOutId) {
		return blockedAccessError({ kind: "blocked", reason: "running" });
	}

	const billingAccess = await requireBillingForMutation(organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	try {
		const clockIn = parseWallClock(
			input.clockInDate,
			input.clockInTime,
			context.timezone,
		);
		const clockOut = parseWallClock(
			input.clockOutDate,
			input.clockOutTime,
			context.timezone,
		);
		if (
			compareInstants(instantFromDate(clockOut), systemClock.nowInstant()) > 0
		) {
			return {
				success: false,
				error: "Clock out time cannot be in the future",
			};
		}
		if (
			compareInstants(instantFromDate(clockOut), instantFromDate(clockIn)) <= 0
		) {
			return {
				success: false,
				error: "Clock out time must be after clock in time",
			};
		}

		const validation = await validateTimeEntryRange(
			organizationId,
			clockIn,
			clockOut,
			context.timezone,
		);
		if (!validation.isValid) {
			return {
				success: false,
				error: validation.error || "Cannot update time entry for this period",
				holidayName: validation.holidayName,
			};
		}

		const requestMetadata = await getRequestMetadata();
		const result = await applyAdminWorkPeriodTimeEdit({
			organizationId,
			actorUserId: target.userId,
			workPeriodId: period.id,
			submissionId: input.submissionId,
			submitted,
			expected: {
				employeeId: period.employeeId,
				clockInId: period.clockInId,
				clockOutId: period.clockOutId,
				startTime: period.startTime,
				endTime: period.endTime,
			},
			clockIn,
			clockOut,
			timezone: context.timezone,
			timezoneSource: target.isOwnEntry
				? "user_setting"
				: "manager_target_user_setting",
			notes,
			ipAddress: requestMetadata.ipAddress,
			deviceInfo: requestMetadata.userAgent,
		});

		if (result.balanceRefresh === "caller") {
			try {
				await markEmployeeWorkBalanceDirty({
					employeeId: result.employeeId,
					organizationId,
					dirtyFromDate: result.dirtyFromDate ?? undefined,
				});
			} catch (error) {
				logger.error(
					{ error, workPeriodId: period.id },
					"Failed to mark work balance dirty after admin time edit",
				);
			}
		}

		logger.info(
			{
				workPeriodId: period.id,
				employeeId: period.employeeId,
				actorUserId: target.userId,
			},
			"Work period times edited by organization admin",
		);
		return { success: true, data: { status: "applied" } };
	} catch (error) {
		if (
			error instanceof ValidationError ||
			error instanceof ConflictError ||
			error instanceof NotFoundError ||
			error instanceof AuthorizationError
		) {
			return { success: false, error: error.message };
		}
		const failure = describeAmendmentFailure(error);
		if (failure) {
			return { success: false, error: failure.message, code: failure.code };
		}
		logger.error({ error }, "Failed to apply admin work period time edit");
		return {
			success: false,
			error: "Failed to update time entry. Please try again.",
		};
	}
}

/**
 * Edits the clock-in/clock-out date and time of a completed work period.
 *
 * - Organization owners/admins: applied immediately, no age limit, any employee.
 * - Employees: follow their resolved change policy. Same-day time edits inside the
 *   self-service window apply directly; everything else inside the approval window
 *   creates a time-correction approval request; older entries are rejected.
 */
export async function updateWorkPeriodTimes(
	rawInput: UpdateWorkPeriodTimesInput,
): Promise<ServerActionResult<{ status: "applied" | "pending" }>> {
	const parsed = updateWorkPeriodTimesSchema.safeParse(rawInput);
	if (!parsed.success) {
		return { success: false, error: "Invalid date or time" };
	}
	const input = parsed.data;
	const loaded = await loadTimeEditTarget(input.workPeriodId);
	if (!loaded.success) {
		return loaded;
	}
	const { target } = loaded;
	const { access, values } = target.context;
	if (access.kind === "blocked") {
		return blockedAccessError(access);
	}

	const next: WorkPeriodTimeEditValues = {
		clockInDate: input.clockInDate,
		clockInTime: input.clockInTime,
		clockOutDate: input.clockOutDate,
		clockOutTime: input.clockOutTime,
	};
	const reason = input.reason.trim();
	const route = resolveWorkPeriodTimeEditRoute(access, {
		datesChanged: haveWorkPeriodDatesChanged(values, next),
	});
	// Direct edits decide "no change" under their own locks, after exact replay:
	// a retried submission that already committed shows its values as current.
	if (
		route === "approval_request" &&
		!haveWorkPeriodTimesChanged(values, next)
	) {
		return {
			success: false,
			error: "At least one correction value must change",
		};
	}
	if (route === "admin_direct") {
		return applyAdminEdit(target, input, reason);
	}

	// Employee edits reuse the existing correction flows, which keep metadata unchanged.
	const correction = {
		workPeriodId: target.period.id,
		newClockInDate: next.clockInDate,
		newClockInTime: next.clockInTime,
		newClockOutDate: next.clockOutDate,
		newClockOutTime: next.clockOutTime,
		workLocationType: normalizeWorkLocationType(target.period.workLocationType),
		workCategoryId: target.period.workCategoryId,
	};

	if (route === "self_service_direct") {
		const result = await editSameDayTimeEntry({
			...correction,
			submissionId: input.submissionId,
			reason: reason || undefined,
		});
		return result.success
			? { success: true, data: { status: "applied" } }
			: result;
	}

	if (!reason) {
		return { success: false, error: "Reason is required" };
	}
	const result = await requestTimeCorrectionEffect({
		...correction,
		submissionId: input.submissionId,
		reason,
	});
	if (!result.success) {
		return result;
	}
	return {
		success: true,
		data: { status: result.data.status === "approved" ? "applied" : "pending" },
	};
}
