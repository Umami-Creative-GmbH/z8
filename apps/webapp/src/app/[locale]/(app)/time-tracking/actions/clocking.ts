import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime, IANAZone } from "luxon";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	approvalRequest,
	type employee,
	workPeriod,
} from "@/db/schema";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import {
	completeOrdinaryWorkPeriodDecisionAfterCommit,
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
} from "@/lib/approvals/server/work-period-approvals";
import {
	executeOrdinaryWorkPeriodSubmissionInTransaction,
	insertOrdinaryWorkPeriodSourceInTransaction,
} from "@/lib/approvals/server/work-period-submission";
import { deriveApprovalWorkflowId } from "@/lib/approvals/workflow/identity";
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import type { WorkCategoryReader } from "@/lib/query/work-category.queries";
import { canonicalWorkRecordClient } from "@/lib/time-tracking/canonical-work-record";
import { attributionIntent, type ClockChannel } from "@/lib/time-tracking/close-active-work";
import { reconcileImmediateSurcharges } from "@/lib/time-tracking/clock-out-effects";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import { APPEND_REVIEW_REQUIRED_CODE } from "@/lib/time-tracking/time-clock-client";
import {
	approvalDbServiceForTransaction,
	createOrdinaryApprovalRuntime,
} from "@/lib/time-tracking/ordinary-approval-runtime";
import {
	exactPlainObject,
	hasPrivateApprovalSubmissionEvidence,
	loadCanonicalEvidence,
	type OrdinarySourceEvidence,
	privateSubmissionMarker,
	requireCanonicalSubmissionId,
	requireReplayOnlySubmission,
	validateCommonEvidence,
} from "@/lib/time-tracking/ordinary-submission-evidence";
import {
	type BreakRefusal,
	type ClockActor,
	type ClockInFailure,
	type ClockInRefusal,
	type ClockInResult,
	type ClockOutFailure,
	type ClockOutRefusal,
	type ClockOutResult,
	clocking,
	type OperationIdentity,
} from "@/lib/time-tracking/clocking";
import { workCategoryIneligibility } from "@/lib/time-tracking/work-category-eligibility";
import { acquireAdoptionGate, readAppendAdmission } from "@/lib/time-tracking/work-transaction";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
	breakFailureMessage,
	clockInFailureMessage,
	clockOutFailureMessage,
} from "./clock-failure-messages";
import {
	sendManualEntryApprovalNotifications,
	sendManualEntryApprovedNotification,
} from "./approvals";
import {
	type CurrentEmployee,
	getCurrentEmployee,
	getCurrentSession,
	getUserTimezone,
} from "./auth";
import { calculateBreaksTakenToday } from "./compliance";
import {
	createTimeEntry,
	validateProjectAssignment,
} from "./entry-helpers";
import {
	resolveManualEntryTarget,
	resolveManualEntryTargetZone,
} from "./manual-entry-target";
import { getEditCapabilityForPeriod } from "./policy-helpers";
import { getActiveWorkPeriod, getTimeSummary } from "./queries";
import {
	BREAK_WARNING_THRESHOLD_MINUTES,
	EMPTY_BREAK_REMINDER_STATUS,
	logger,
	ONE_MINUTE_MS,
} from "./shared";
import { calculateDurationMinutes, createUtcDateTime } from "./time-utils";
import type {
	BrowserTimezoneContext,
	ClockOutActionContext,
	ManualTimeEntryInput,
} from "./types";
import { MANUAL_ENTRY_REFRESH_REQUIRED } from "./types";

type ManualEntryOverlapResult =
	| {
			adjustedClockIn: Date;
			adjustedClockOut: Date;
			wasAdjusted: boolean;
	  }
	| {
			error: string;
	  };

type WorkBalanceDirtyInput = Parameters<typeof markEmployeeWorkBalanceDirty>[0];

const APPROVAL_POLICY_CHECK_ERROR =
	"Could not verify time approval policy. Please try again.";
type ManualSubmissionRequestEvidence = {
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	timezone: string | null;
	browserTimezone: string | null;
	projectId: string | null;
	workCategoryId: string | null;
};

type ManualSubmissionResultEvidence = {
	startTime: string;
	endTime: string;
	durationMinutes: number;
	wasAdjusted: boolean;
};

function manualRequestEvidence(
	data: ManualTimeEntryInput,
): ManualSubmissionRequestEvidence {
	return {
		date: data.date,
		clockInTime: data.clockInTime,
		clockOutTime: data.clockOutTime,
		reason: data.reason,
		timezone: data.timezone ?? null,
		browserTimezone: data.browserTimezone ?? null,
		projectId: data.projectId ?? null,
		workCategoryId: data.workCategoryId ?? null,
	};
}

function manualSubmissionMetadata(input: {
	submissionId: string;
	request: ManualSubmissionRequestEvidence;
	result: ManualSubmissionResultEvidence;
}): string {
	return JSON.stringify({
		ordinarySubmission: {
			submissionId: input.submissionId,
			kind: "manual_time_submission",
		},
		request: input.request,
		result: input.result,
	});
}

function parseManualSubmissionMetadata(input: {
	value: unknown;
	submissionId: string;
	request: ManualSubmissionRequestEvidence;
}): ManualSubmissionResultEvidence {
	if (typeof input.value !== "string") throw new Error("Submission collision");
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.value);
	} catch {
		throw new Error("Submission collision");
	}
	const root = exactPlainObject(parsed, [
		"ordinarySubmission",
		"request",
		"result",
	]);
	const marker = exactPlainObject(root.ordinarySubmission, [
		"submissionId",
		"kind",
	]);
	if (
		marker.submissionId !== input.submissionId ||
		marker.kind !== "manual_time_submission"
	) {
		throw new Error("Submission collision");
	}
	const request = exactPlainObject(root.request, [
		"date",
		"clockInTime",
		"clockOutTime",
		"reason",
		"timezone",
		"browserTimezone",
		"projectId",
		"workCategoryId",
	]);
	for (const [key, expected] of Object.entries(input.request)) {
		if (request[key] !== expected) throw new Error("Submission collision");
	}
	const result = exactPlainObject(root.result, [
		"startTime",
		"endTime",
		"durationMinutes",
		"wasAdjusted",
	]);
	if (
		typeof result.startTime !== "string" ||
		typeof result.endTime !== "string" ||
		!Number.isSafeInteger(result.durationMinutes) ||
		typeof result.wasAdjusted !== "boolean"
	) {
		throw new Error("Submission collision");
	}
	try {
		parseInstant(result.startTime);
		parseInstant(result.endTime);
	} catch {
		throw new Error("Submission collision");
	}
	return result as ManualSubmissionResultEvidence;
}

async function bestEffort(
	operation: () => Promise<unknown>,
	message: string,
	context: Record<string, unknown>,
) {
	try {
		await operation();
	} catch (error) {
		logger.error({ error, ...context }, message);
	}
}

async function findManualSubmissionEvidence(input: {
	tx: typeof db;
	submissionId: string;
	organizationId: string;
	employeeId: string;
	request: ManualSubmissionRequestEvidence;
}) {
	const period = (await input.tx.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.id, input.submissionId),
			eq(workPeriod.organizationId, input.organizationId),
			eq(workPeriod.employeeId, input.employeeId),
		),
		with: { clockIn: true, clockOut: true },
	})) as OrdinarySourceEvidence | undefined;
	if (!period) return null;
	const canonical = await loadCanonicalEvidence(
		input.tx,
		period,
		input.organizationId,
	);
	if (canonical.workRows.length !== 1 || !canonical.workRows[0]) {
		throw new Error("Submission collision");
	}
	const result = parseManualSubmissionMetadata({
		value: canonical.workRows[0].computationMetadata,
		submissionId: input.submissionId,
		request: input.request,
	});
	const startTime = dateFromInstant(parseInstant(result.startTime));
	const endTime = dateFromInstant(parseInstant(result.endTime));
	validateCommonEvidence({
		period,
		canonical,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startTime,
		endTime,
		durationMinutes: result.durationMinutes,
		origin: "manual",
	});
	const marker = privateSubmissionMarker(period.pendingChanges);
	if (
		period.projectId !== input.request.projectId ||
		period.workCategoryId !== input.request.workCategoryId ||
		period.clockIn?.notes !== `Manual entry: ${input.request.reason}` ||
		period.clockOut?.notes !== input.request.reason ||
		(marker !== null &&
			(marker.submissionId !== input.submissionId ||
				marker.kind !== "manual_time_submission"))
	) {
		throw new Error("Submission collision");
	}
	const submissionKey = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "manual_time_submission",
		sourceType: "time_entry",
		sourceId: period.id,
		allocationKey: input.submissionId,
	});
	const expectedWorkflowId = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "manual_time_submission",
		sourceType: "time_entry",
		sourceId: period.id,
		allocationKey: submissionKey,
	});
	let hasApprovalEvidence = period.approvalWorkflowId === expectedWorkflowId;
	if (!hasApprovalEvidence) {
		const requests = await input.tx.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, period.id),
			),
			columns: { metadata: true },
		});
		const requestEvidence = requests.map((request) =>
			hasPrivateApprovalSubmissionEvidence({
				metadata: request.metadata,
				expectedKey: submissionKey,
				submissionId: input.submissionId,
				expectedKind: "manual_time_submission",
			}),
		);
		hasApprovalEvidence = requestEvidence.some(Boolean);
	}
	if (period.approvalStatus === "pending" && !hasApprovalEvidence) {
		throw new Error("Submission collision");
	}
	return { period, requiresApproval: hasApprovalEvidence, result };
}

async function lockManualSubmission(input: {
	tx: typeof db;
	organizationId: string;
	submissionId: string;
}) {
	const key = JSON.stringify([
		input.organizationId,
		"manual_time_submission",
		"time_entry",
		input.submissionId,
	]);
	await input.tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
	);
}

async function findAndReplayManualSubmission(input: {
	context: ApprovalWorkflowTransactionContext;
	submissionId: string;
	request: ManualSubmissionRequestEvidence;
	targetEmployee: typeof employee.$inferSelect;
	requesterUserId: string;
}) {
	const tx = input.context.dbService.db as unknown as typeof db;
	await lockManualSubmission({
		tx,
		organizationId: input.targetEmployee.organizationId,
		submissionId: input.submissionId,
	});
	const evidence = await findManualSubmissionEvidence({
		tx,
		submissionId: input.submissionId,
		organizationId: input.targetEmployee.organizationId,
		employeeId: input.targetEmployee.id,
		request: input.request,
	});
	if (!evidence) return null;
	const approvalSubmission = evidence.requiresApproval
		? requireReplayOnlySubmission(
				await executeOrdinaryWorkPeriodSubmissionInTransaction({
					dbService: approvalDbServiceForTransaction(input.context.dbService),
					context: input.context,
					organizationId: input.targetEmployee.organizationId,
					workPeriodId: evidence.period.id,
					submissionId: input.submissionId,
					requesterEmployeeId: input.targetEmployee.id,
					requesterUserId: input.targetEmployee.userId ?? input.requesterUserId,
					teamId: input.targetEmployee.teamId,
					defaultApproverId: null,
					reason: `Manual time entry: ${input.request.reason}`,
					overtimeRisk: "none",
					kind: "manual_time_submission",
					metadata: {},
				}),
			)
		: null;
	return { ...evidence, approvalSubmission };
}

export type ClockActionContext = BrowserTimezoneContext & {
	/**
	 * Identity of this clock-in attempt. A retry with the same identity replays the
	 * committed start; without one the server generates an identity that names the
	 * operation but cannot recognize a retry.
	 */
	submissionId?: string;
	/** Where the submission id came from; bots derive theirs from the platform invocation. */
	identityOrigin?: OperationIdentity["origin"];
	instant?: Instant;
	deviceInfo?: ClockChannel;
};

export type ClockInCommandResult =
	| { success: true; data: ClockInResult }
	| { success: false; failure: ClockInFailure; refusal: ClockInRefusal };

async function markWorkBalanceDirtyAfterManualTimeEntryBestEffort(
	input: WorkBalanceDirtyInput,
	context: Record<string, unknown>,
) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error(
			{ error, ...context },
			"Failed to mark work balance dirty after manual time entry",
		);
	}
}

export async function validateWorkCategoryAssignment(
	employeeId: string,
	workCategoryId: string,
	organizationId: string,
	/** Protected preparation passes its transaction and evaluation instant. */
	reader: WorkCategoryReader = db,
	now: Date = new Date(),
) {
	const ineligibility = await workCategoryIneligibility(
		{ employeeId, organizationId, workCategoryId },
		reader,
		now,
	);
	if (ineligibility === "not_found") {
		return { isValid: false, error: "Work category not found" };
	}
	return ineligibility === null
		? { isValid: true }
		: { isValid: false, error: "Cannot assign to this work category" };
}

/**
 * Web clock-in. Every refusal is worded in the `timeTracking` namespace; the
 * wire keeps the codes the client acts on (billing, append review, occupancy)
 * and the holiday's name.
 */
export async function clockIn(
	workLocationType?: WorkLocationType,
	actionContext: ClockActionContext = {},
): Promise<ServerActionResult<ClockInResult>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: await clockInFailureMessage("not_authenticated") };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: await clockInFailureMessage("employee_not_found") };
	}

	const result = await clockInAs(
		webClockActor(session.user.id, currentEmployee),
		workLocationType,
		actionContext,
	);
	if (result.success) return { success: true, data: result.data };
	const { refusal } = result;
	switch (refusal.code) {
		case "billing_required":
			return { success: false, error: "billing_required", code: refusal.reason };
		case "holiday_blocked":
			return {
				success: false,
				error: await clockInFailureMessage("holiday_blocked", {
					holidayName: refusal.holidayName ?? "",
				}),
				holidayName: refusal.holidayName,
			};
		case "append_review_required":
			return {
				success: false,
				error: await clockInFailureMessage(refusal.code),
				code: APPEND_REVIEW_REQUIRED_CODE,
			};
		case "occupancy_conflict":
			return {
				success: false,
				error: await clockInFailureMessage(refusal.code),
				code: refusal.code,
			};
		default:
			return { success: false, error: await clockInFailureMessage(refusal.code) };
	}
}

function webClockActor(
	userId: string,
	employee: CurrentEmployee,
): ClockActor {
	return { userId, employee, resolveTimezone: () => getUserTimezone(userId) };
}

/** Operator detail for refusals; the employee sees only the worded code. */
function logClockInRefusal(refusal: ClockInRefusal) {
	switch (refusal.code) {
		case "unconfirmed":
			logger.error({ error: refusal.cause }, "Clock in error");
			return;
		case "failed":
			// The replay transaction only reads, so this attempt wrote nothing.
			logger.error({ error: refusal.cause }, "Clock in replay error");
			return;
		case "collision":
			logger.warn({ error: refusal.cause }, "Clock in identity collision");
			return;
		case "append_review_required":
			logger.warn(
				{ appendReviewRequirement: refusal.requirement },
				"Clock in held for append history review",
			);
			return;
	}
}

/**
 * The live clock-in adapter shared by the web, mobile and bots: it turns an
 * authenticated actor's request into a Clocking command and the outcome into a
 * result. The web sends a client operation identity and bots a derived one where
 * their platform names the invocation; without one the identity is the server's.
 */
export async function clockInAs(
	actor: ClockActor,
	workLocationType: WorkLocationType = "office",
	actionContext: ClockActionContext = {},
): Promise<ClockInCommandResult> {
	const outcome = await clocking.run({
		organizationId: actor.employee.organizationId,
		principal: { kind: "user", userId: actor.userId },
		subject: { employeeId: actor.employee.id },
		identity: actionContext.submissionId
			? { origin: actionContext.identityOrigin ?? "client", id: actionContext.submissionId }
			: { origin: "server", id: crypto.randomUUID() },
		channel: actionContext.deviceInfo ?? "web",
		at: actionContext.instant
			? { kind: "occurred", instant: actionContext.instant }
			: { kind: "now" },
		zone: {
			device: actionContext.browserTimezone ?? null,
			fallback: await actor.resolveTimezone(),
		},
		body: { kind: "clock_in", workLocationType },
	});
	if (outcome.outcome === "refused") {
		logClockInRefusal(outcome.failure);
		return { success: false, failure: outcome.failure.code, refusal: outcome.failure };
	}
	return { success: true, data: outcome.result };
}

/** Refreshes the web cache after a committed closure; never fails the closure. */
export async function revalidateAfterClockOut(context: Record<string, unknown>) {
	try {
		revalidatePath("/time-tracking");
	} catch (error) {
		logger.error({ error, ...context }, "Failed to revalidate time tracking after clock-out");
	}
}

/**
 * Web clock-out. `undefined` attribution preserves the active period's project or
 * category; `null` clears it explicitly. Every refusal is worded in the
 * `timeTracking` namespace.
 */
export async function clockOut(
	projectId: string | null | undefined,
	workCategoryId: string | null | undefined,
	actionContext: ClockOutActionContext,
): Promise<ServerActionResult<ClockOutResult>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: await clockOutFailureMessage("not_authenticated") };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: await clockOutFailureMessage("employee_not_found") };
	}
	const result = await clockOutAs(
		webClockActor(session.user.id, currentEmployee),
		projectId,
		workCategoryId,
		actionContext,
	);
	if (result.success) return { success: true, data: result.data };
	if (result.refusal.code === "billing_required") {
		return { success: false, error: "billing_required", code: result.refusal.reason };
	}
	return { success: false, error: await clockOutFailureMessage(result.refusal.code) };
}

export type ClockOutCommandResult =
	| { success: true; data: ClockOutResult; durationMinutes: number | null }
	| { success: false; failure: ClockOutFailure; refusal: ClockOutRefusal };

/** Operator detail for refusals; the employee sees only the worded code. */
function logClockOutRefusal(refusal: ClockOutRefusal) {
	switch (refusal.code) {
		case "unconfirmed":
			logger.error({ error: refusal.cause }, "Clock out error");
			return;
		case "failed":
			// The replay transaction only reads, so this attempt wrote nothing.
			logger.error({ error: refusal.cause }, "Clock out replay error");
			return;
		case "collision":
			logger.warn({ error: refusal.cause }, "Clock out identity collision");
			return;
		case "append_review_required":
			logger.warn(
				{ appendReviewRequirement: refusal.requirement },
				"Clock out held for append history review",
			);
			return;
	}
}

/**
 * The live clock-out adapter shared by the web, mobile and bots: it turns an
 * authenticated actor's request into a Clocking command and the outcome into a
 * result. Web and mobile send a client operation identity; bots send a server
 * one, which is never replayed.
 */
export async function clockOutAs(
	actor: ClockActor,
	projectId: string | null | undefined,
	workCategoryId: string | null | undefined,
	actionContext: ClockOutActionContext,
): Promise<ClockOutCommandResult> {
	const outcome = await clocking.run({
		organizationId: actor.employee.organizationId,
		principal: { kind: "user", userId: actor.userId },
		subject: { employeeId: actor.employee.id },
		identity: {
			origin: actionContext.identityOrigin ?? "client",
			id: String(actionContext.submissionId),
		},
		channel: actionContext.deviceInfo ?? "web",
		at: actionContext.instant
			? { kind: "occurred", instant: actionContext.instant }
			: { kind: "now" },
		zone: {
			device: actionContext.browserTimezone ?? null,
			fallback: await actor.resolveTimezone(),
		},
		body: {
			kind: "clock_out",
			project: attributionIntent(projectId),
			workCategory: attributionIntent(workCategoryId),
		},
	});
	if (outcome.outcome === "refused") {
		logClockOutRefusal(outcome.failure);
		return { success: false, failure: outcome.failure.code, refusal: outcome.failure };
	}
	if (outcome.outcome === "executed") {
		await revalidateAfterClockOut({
			organizationId: actor.employee.organizationId,
			entryId: outcome.result.id,
		});
	}
	return { success: true, data: outcome.result, durationMinutes: outcome.durationMinutes };
}

export type AddBreakActionContext = {
	/**
	 * Identity of this break attempt. A retry with the same identity replays the
	 * committed break; without one the server generates an identity that names
	 * the operation but cannot recognize a retry.
	 */
	submissionId?: string;
	browserTimezone?: string | null;
};

/** Operator detail for refusals; the employee sees only the worded code. */
function logBreakRefusal(refusal: BreakRefusal) {
	switch (refusal.code) {
		case "unconfirmed":
			logger.error({ error: refusal.cause }, "Add break to active session error");
			return;
		case "failed":
			// The replay transaction only reads, so this attempt wrote nothing.
			logger.error({ error: refusal.cause }, "Add break replay error");
			return;
		case "collision":
			logger.warn({ error: refusal.cause }, "Add break identity collision");
			return;
		case "append_review_required":
			logger.warn(
				{ appendReviewRequirement: refusal.requirement },
				"Add break held for append history review",
			);
			return;
	}
}

/**
 * Web break on the active session (#304): a Clocking command that closes the
 * active work `breakMinutes` ago and resumes it now. Every refusal is worded in
 * the `timeTracking` namespace; the wire keeps the billing code.
 */
export async function addBreakToActiveSession(
	breakMinutes: number,
	actionContext: AddBreakActionContext = {},
): Promise<ServerActionResult<{ id: string; startTime: Date }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: await breakFailureMessage({ code: "not_authenticated" }) };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: await breakFailureMessage({ code: "employee_not_found" }) };
	}

	const outcome = await clocking.run({
		organizationId: currentEmployee.organizationId,
		principal: { kind: "user", userId: session.user.id },
		subject: { employeeId: currentEmployee.id },
		identity:
			actionContext.submissionId === undefined
				? { origin: "server", id: crypto.randomUUID() }
				: { origin: "client", id: actionContext.submissionId },
		channel: "web",
		at: { kind: "now" },
		zone: {
			device: actionContext.browserTimezone ?? null,
			fallback: await getUserTimezone(session.user.id),
		},
		body: { kind: "break", breakMinutes },
	});
	if (outcome.outcome === "refused") {
		const { failure } = outcome;
		logBreakRefusal(failure);
		if (failure.code === "billing_required") {
			return { success: false, error: "billing_required", code: failure.reason };
		}
		return { success: false, error: await breakFailureMessage(failure) };
	}
	if (outcome.outcome === "executed") {
		await revalidateAfterClockOut({
			organizationId: currentEmployee.organizationId,
			workPeriodId: outcome.result.workPeriodId,
		});
	}
	return {
		success: true,
		data: { id: outcome.result.workPeriodId, startTime: dateFromInstant(outcome.result.start) },
	};
}

export async function getBreakReminderStatus(): Promise<
	ServerActionResult<{
		needsBreakSoon: boolean;
		uninterruptedMinutes: number;
		maxUninterrupted: number | null;
		minutesUntilBreakRequired: number | null;
		breakRequirement: {
			isRequired: boolean;
			totalNeeded: number;
			taken: number;
			remaining: number;
		} | null;
	}>
> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const [timezone, activeWorkPeriod] = await Promise.all([
		getUserTimezone(session.user.id),
		getActiveWorkPeriod(currentEmployee.id),
	]);
	if (!activeWorkPeriod) {
		return { success: true, data: EMPTY_BREAK_REMINDER_STATUS };
	}

	try {
		const currentSessionMinutes = calculateDurationMinutes(
			activeWorkPeriod.startTime,
			new Date(),
		);
		const [timeSummary, breaksTaken] = await Promise.all([
			getTimeSummary(currentEmployee.id, timezone),
			calculateBreaksTakenToday(currentEmployee.id, timezone),
		]);

		const breakStatusEffect = Effect.gen(function* (_) {
			const workPolicyService = yield* _(WorkPolicyService);
			const policy = yield* _(
				workPolicyService.getEffectivePolicy(currentEmployee.id),
			);

			if (!policy?.regulation) {
				return {
					...EMPTY_BREAK_REMINDER_STATUS,
					uninterruptedMinutes: currentSessionMinutes,
				};
			}

			const breakRequirement = workPolicyService.calculateBreakRequirements({
				regulation: policy.regulation,
				workedMinutes: timeSummary.todayMinutes + currentSessionMinutes,
				breaksTakenMinutes: breaksTaken,
			});

			const maxUninterrupted = policy.regulation.maxUninterruptedMinutes;
			const minutesUntilBreakRequired = maxUninterrupted
				? maxUninterrupted - currentSessionMinutes
				: null;
			const isBreakThresholdReached =
				minutesUntilBreakRequired !== null &&
				minutesUntilBreakRequired <= BREAK_WARNING_THRESHOLD_MINUTES;
			const needsBreakSoon =
				isBreakThresholdReached ||
				(breakRequirement.isRequired && breakRequirement.remaining > 0);

			return {
				needsBreakSoon,
				uninterruptedMinutes: currentSessionMinutes,
				maxUninterrupted,
				minutesUntilBreakRequired,
				breakRequirement: breakRequirement.isRequired
					? {
							isRequired: true,
							totalNeeded: breakRequirement.totalBreakNeeded,
							taken: breakRequirement.breakTaken,
							remaining: breakRequirement.remaining,
						}
					: null,
			};
		}).pipe(
			Effect.provide(WorkPolicyServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		return { success: true, data: await Effect.runPromise(breakStatusEffect) };
	} catch (error) {
		logger.error({ error }, "Failed to get break reminder status");
		return { success: false, error: "Failed to check break status" };
	}
}

function adjustManualEntryForOverlaps(
	existingWorkPeriods: Array<{ startTime: Date; endTime: Date | null }>,
	clockInDate: Date,
	clockOutDate: Date,
): ManualEntryOverlapResult {
	let adjustedClockIn = clockInDate;
	let adjustedClockOut = clockOutDate;
	let wasAdjusted = false;

	const sortedWorkPeriods = existingWorkPeriods
		.filter((workPeriod) => workPeriod.endTime !== null)
		.sort(
			(left, right) => left.startTime.getTime() - right.startTime.getTime(),
		);

	for (const existingWorkPeriod of sortedWorkPeriods) {
		if (!existingWorkPeriod.endTime) continue;
		const periodStart = existingWorkPeriod.startTime.getTime();
		const periodEnd = existingWorkPeriod.endTime.getTime();
		const newStart = adjustedClockIn.getTime();
		const newEnd = adjustedClockOut.getTime();

		if (newStart < periodEnd && newEnd > periodStart) {
			wasAdjusted = true;

			if (
				newStart < periodStart &&
				newEnd > periodStart &&
				newEnd <= periodEnd
			) {
				adjustedClockOut = new Date(periodStart - ONE_MINUTE_MS);
			} else if (
				newStart >= periodStart &&
				newStart < periodEnd &&
				newEnd > periodEnd
			) {
				adjustedClockIn = new Date(periodEnd + ONE_MINUTE_MS);
			} else if (newStart < periodStart && newEnd > periodEnd) {
				adjustedClockOut = new Date(periodStart - ONE_MINUTE_MS);
			} else if (newStart >= periodStart && newEnd <= periodEnd) {
				return {
					error:
						"The selected time range is completely covered by an existing work period.",
				} as const;
			}
		}
	}

	if (adjustedClockOut.getTime() - adjustedClockIn.getTime() < ONE_MINUTE_MS) {
		return {
			error:
				"After adjusting for existing entries, the remaining time is too short (less than 1 minute).",
		} as const;
	}

	return { adjustedClockIn, adjustedClockOut, wasAdjusted } as const;
}

export async function createManualTimeEntry(
	data: ManualTimeEntryInput,
): Promise<
	ServerActionResult<{
		workPeriodId: string;
		requiresApproval: boolean;
		wasAdjusted?: boolean;
		adjustedTimes?: {
			clockIn: string;
			clockOut: string;
			durationMinutes: number;
		};
	}>
> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	let submissionId: string;
	try {
		submissionId = requireCanonicalSubmissionId(data.submissionId);
	} catch {
		return {
			success: false,
			error: "Failed to create time entry. Please try again.",
		};
	}
	const targetResolution = await resolveManualEntryTarget({
		currentEmployee,
		requestedEmployeeId: data.employeeId,
	});
	if (!targetResolution.success) {
		return targetResolution;
	}
	const { targetEmployee, isOwnEntry } = targetResolution;
	const requestEvidence = manualRequestEvidence(data);
	try {
		const runtime = createOrdinaryApprovalRuntime();
		const replay = await runtime.repository.withTransaction((context) =>
			findAndReplayManualSubmission({
				context,
				submissionId,
				request: requestEvidence,
				targetEmployee,
				requesterUserId: session.user.id,
			}),
		);
		if (replay) {
			const approvalAutoCompleted =
				replay.approvalSubmission?.result.kind === "auto_completed";
			return {
				success: true,
				data: {
					workPeriodId: replay.period.id,
					requiresApproval: replay.requiresApproval && !approvalAutoCompleted,
					wasAdjusted: replay.result.wasAdjusted,
					adjustedTimes: replay.result.wasAdjusted
						? {
								clockIn: replay.result.startTime,
								clockOut: replay.result.endTime,
								durationMinutes: replay.result.durationMinutes,
							}
						: undefined,
				},
			};
		}
	} catch (error) {
		logger.error({ error }, "Failed to replay manual time entry");
		return {
			success: false,
			error: "Failed to create time entry. Please try again.",
		};
	}

	if (
		isOwnEntry &&
		data.timezone !== undefined &&
		!IANAZone.isValidZone(data.timezone)
	) {
		return { success: false, error: "Invalid timezone" };
	}

	// On-behalf entries always use the target's zone, never the actor's browser.
	const { timezone: targetTimezone } = await resolveManualEntryTargetZone({
		userId: isOwnEntry ? session.user.id : targetEmployee.userId,
		organizationId: targetEmployee.organizationId,
	});
	const timezone = isOwnEntry
		? (data.timezone ?? targetTimezone)
		: targetTimezone;
	const matchingBrowserTimezone =
		isOwnEntry &&
		data.browserTimezone === timezone &&
		IANAZone.isValidZone(data.browserTimezone)
			? data.browserTimezone
			: null;
	const clockInDate = createUtcDateTime(data.date, data.clockInTime, timezone);
	const clockOutDate = createUtcDateTime(
		data.date,
		data.clockOutTime,
		timezone,
	);

	if (!clockInDate || !clockOutDate) {
		return { success: false, error: "Invalid time values" };
	}

	const now = new Date();
	if (clockOutDate > now) {
		return { success: false, error: "Cannot create entries for future times" };
	}

	if (clockOutDate <= clockInDate) {
		return {
			success: false,
			error: "Clock out time must be after clock in time",
		};
	}

	const validation = await validateTimeEntryRange(
		targetEmployee.organizationId,
		clockInDate,
		clockOutDate,
	);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot create time entry for this period",
			holidayName: validation.holidayName,
		};
	}

	if (data.projectId) {
		const projectValidation = await validateProjectAssignment(
			data.projectId,
			targetEmployee.id,
			targetEmployee.teamId,
			targetEmployee.organizationId,
		);

		if (!projectValidation.isValid) {
			return {
				success: false,
				error: projectValidation.error || "Cannot assign to this project",
			};
		}
	}
	if (data.workCategoryId) {
		const categoryValidation = await validateWorkCategoryAssignment(
			targetEmployee.id,
			data.workCategoryId,
			targetEmployee.organizationId,
		);
		if (!categoryValidation.isValid) {
			return {
				success: false,
				error:
					categoryValidation.error || "Cannot assign to this work category",
			};
		}
	}

	let requiresApproval = false;
	if (isOwnEntry) {
		let editCapability: Awaited<ReturnType<typeof getEditCapabilityForPeriod>> | null;
		try {
			// Organization owners and admins are not limited to employee self-service windows.
			editCapability = (await isOrgAdminCasl(targetEmployee.organizationId))
				? null
				: await getEditCapabilityForPeriod({
						employeeId: targetEmployee.id,
						workPeriodEndTime: clockOutDate,
						timezone,
					});
		} catch (error) {
			logger.error(
				{ error },
				"Failed to check edit capability for manual entry",
			);
			return { success: false, error: APPROVAL_POLICY_CHECK_ERROR };
		}

		// Older manual entries require approval instead of being blocked by age.
		requiresApproval =
			editCapability?.type === "approval_required" || editCapability?.type === "forbidden";
	}

	try {
		const localDate = DateTime.fromISO(data.date, { zone: timezone });
		if (!localDate.isValid) {
			return { success: false, error: "Invalid date format" };
		}

		const existingWorkPeriods = await db.query.workPeriod.findMany({
			where: and(
				eq(workPeriod.employeeId, targetEmployee.id),
				eq(workPeriod.organizationId, targetEmployee.organizationId),
				gte(workPeriod.startTime, localDate.startOf("day").toUTC().toJSDate()),
				lte(workPeriod.startTime, localDate.endOf("day").toUTC().toJSDate()),
			),
		});

		if (existingWorkPeriods.some((workPeriod) => !workPeriod.endTime)) {
			return {
				success: false,
				error:
					"Cannot create manual entry while you have an active work period. Please clock out first.",
			};
		}

		const overlapResult = adjustManualEntryForOverlaps(
			existingWorkPeriods.filter((period) => period.id !== submissionId),
			clockInDate,
			clockOutDate,
		);
		if ("error" in overlapResult) {
			return { success: false, error: overlapResult.error };
		}

		const { adjustedClockIn, adjustedClockOut, wasAdjusted } = overlapResult;
		const clockInTimezoneCapture = isOwnEntry
			? resolveTimeEntryTimezoneCapture({
					timestamp: adjustedClockIn,
					browserTimezone: matchingBrowserTimezone,
					fallbackTimezone: timezone,
					browserSource: "browser",
					fallbackSource: "user_setting",
				})
			: resolveFallbackTimezoneCapture({
					timestamp: adjustedClockIn,
					timezone,
					timezoneSource: "manager_target_user_setting",
				});
		const clockOutTimezoneCapture = isOwnEntry
			? resolveTimeEntryTimezoneCapture({
					timestamp: adjustedClockOut,
					browserTimezone: matchingBrowserTimezone,
					fallbackTimezone: timezone,
					browserSource: "browser",
					fallbackSource: "user_setting",
				})
			: resolveFallbackTimezoneCapture({
					timestamp: adjustedClockOut,
					timezone,
					timezoneSource: "manager_target_user_setting",
				});
		const durationMinutes = calculateDurationMinutes(
			adjustedClockIn,
			adjustedClockOut,
		);
		const resultEvidence: ManualSubmissionResultEvidence = {
			startTime: adjustedClockIn.toISOString(),
			endTime: adjustedClockOut.toISOString(),
			durationMinutes,
			wasAdjusted,
		};
		let immediateSurchargeSnapshot: PolicyClockOutSurchargeSnapshot | null =
			null;
		const runtime = createOrdinaryApprovalRuntime();
		const committed = await runtime.repository.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as typeof db;
			// Adopted organizations (#308) admit fresh work only from version-2
			// commands; unversioned input may still replay what it committed.
			await acquireAdoptionGate(tx, targetEmployee.organizationId);
			const admission = await readAppendAdmission(tx, targetEmployee.organizationId);
			const existingEvidence = await findAndReplayManualSubmission({
				context,
				submissionId,
				request: requestEvidence,
				targetEmployee,
				requesterUserId: session.user.id,
			});
			if (existingEvidence) {
				return {
					period: existingEvidence.period,
					approvalSubmission: existingEvidence.approvalSubmission,
					disposition: "replayed" as const,
					requiresApproval: existingEvidence.requiresApproval,
					resultEvidence: existingEvidence.result,
				};
			}
			// Absence is established under the submission identity lock.
			if (admission === "append") return { disposition: "refresh_required" as const };
			const clockInEntry = await createTimeEntry(
				{
					employeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
					type: "clock_in",
					timestamp: adjustedClockIn,
					createdBy: session.user.id,
					notes: `Manual entry: ${data.reason}`,
					...clockInTimezoneCapture,
				},
				tx,
			);
			const [clockOutEntry, surchargeSnapshot] = await Promise.all([
				createTimeEntry(
					{
						employeeId: targetEmployee.id,
						organizationId: targetEmployee.organizationId,
						type: "clock_out",
						timestamp: adjustedClockOut,
						createdBy: session.user.id,
						notes: data.reason,
						...clockOutTimezoneCapture,
						chainAfter: clockInEntry,
					},
					tx,
				),
				resolvePolicyClockOutSurchargeSnapshotInTransaction({
					dbService: context.dbService as never,
					organizationId: targetEmployee.organizationId,
					employeeId: targetEmployee.id,
					startTime: instantFromDate(adjustedClockIn),
					endTime: instantFromDate(adjustedClockOut),
				}),
			]);
			if (!requiresApproval) immediateSurchargeSnapshot = surchargeSnapshot;
			const canonicalRecord =
				await canonicalWorkRecordClient.createForCompletedPeriod(
					{
						organizationId: targetEmployee.organizationId,
						employeeId: targetEmployee.id,
						startAt: adjustedClockIn,
						endAt: adjustedClockOut,
						durationMinutes,
						approvalState: requiresApproval ? "pending" : "approved",
						createdBy: session.user.id,
						workCategoryId: data.workCategoryId || null,
						projectId: data.projectId || null,
						computationMetadata: manualSubmissionMetadata({
							submissionId,
							request: requestEvidence,
							result: resultEvidence,
						}),
						origin: "manual",
					},
					tx,
				);

			const period = await insertOrdinaryWorkPeriodSourceInTransaction({
				dbService: approvalDbServiceForTransaction(context.dbService),
				id: submissionId,
				employeeId: targetEmployee.id,
				organizationId: targetEmployee.organizationId,
				clockInId: clockInEntry.id,
				clockOutId: clockOutEntry.id,
				startTime: adjustedClockIn,
				endTime: adjustedClockOut,
				durationMinutes,
				projectId: data.projectId || null,
				workCategoryId: data.workCategoryId || null,
				canonicalRecordId: canonicalRecord.id,
				approvalStatus: requiresApproval ? "pending" : "approved",
				pendingChanges: requiresApproval
					? {
							ordinarySubmission: {
								submissionId,
								kind: "manual_time_submission" as const,
							},
							originalStartTime: adjustedClockIn.toISOString(),
							originalEndTime: adjustedClockOut.toISOString(),
							originalDurationMinutes: durationMinutes,
							requestedAt: now.toISOString(),
							requestedBy: session.user.id,
							reason: data.reason,
							isManualEntry: true,
							surchargeSnapshot,
						}
					: null,
			});

			const approvalSubmission = requiresApproval
				? await executeOrdinaryWorkPeriodSubmissionInTransaction({
						dbService: approvalDbServiceForTransaction(context.dbService),
						context,
						organizationId: targetEmployee.organizationId,
						workPeriodId: period.id,
						submissionId,
						requesterEmployeeId: targetEmployee.id,
						requesterUserId: targetEmployee.userId ?? session.user.id,
						teamId: targetEmployee.teamId,
						defaultApproverId: null,
						reason: `Manual time entry: ${data.reason}`,
						overtimeRisk: "none",
						kind: "manual_time_submission",
						metadata: {},
						submitterUserId: session.user.id,
					})
				: null;

			return {
				period,
				approvalSubmission,
				disposition: "executed" as const,
				requiresApproval,
				resultEvidence,
			};
		});
		if (committed.disposition === "refresh_required") {
			return {
				success: false,
				error: "Manual entry settings changed. Please review the entry and submit it again.",
				code: MANUAL_ENTRY_REFRESH_REQUIRED,
			};
		}
		const {
			period: createdWorkPeriod,
			approvalSubmission,
			disposition,
			requiresApproval: committedRequiresApproval,
			resultEvidence: committedResultEvidence,
		} = committed;
		requiresApproval = committedRequiresApproval;

		const approvalResult = approvalSubmission?.result;
		if (requiresApproval && approvalSubmission?.disposition === "executed") {
			await completeOrdinaryWorkPeriodDecisionAfterCommit({
				execute: async () => approvalSubmission,
				dispatchPending: true,
				dispatch: async (execution) => {
					const descriptor = execution.postCommit;
					const managerId = descriptor?.approverEmployeeId;
					if (!descriptor || !managerId) return;
					const params = {
						workPeriodId: createdWorkPeriod.id,
						employeeId: targetEmployee.id,
						managerId,
						organizationId: targetEmployee.organizationId,
						startTime: adjustedClockIn,
						endTime: adjustedClockOut,
						durationMinutes,
						reason: data.reason,
						dedupeKey: descriptor.dedupeKey,
					};
					await (descriptor.event === "approved"
						? sendManualEntryApprovedNotification(params)
						: sendManualEntryApprovalNotifications(params));
				},
				maintain: reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
				onDispatchError: (error) =>
					logger.error(
						{
							error,
							organizationId: targetEmployee.organizationId,
							workPeriodId: createdWorkPeriod.id,
						},
						"Failed to dispatch manual-entry approval notification after commit",
					),
				onMaintenanceError: (error) =>
					logger.error(
						{
							error,
							organizationId: targetEmployee.organizationId,
							workPeriodId: createdWorkPeriod.id,
						},
						"Failed to reconcile manual-entry approval maintenance after commit",
					),
			});
		}

		const approvalAutoCompleted = approvalResult?.kind === "auto_completed";
		const shouldRunPostCommitEffects =
			disposition === "executed" &&
			(!requiresApproval || approvalSubmission?.disposition === "executed");
		if (shouldRunPostCommitEffects && !requiresApproval) {
			await bestEffort(
				() =>
					immediateSurchargeSnapshot
						? reconcileImmediateSurcharges({
								affectedWorkPeriodIds: [createdWorkPeriod.id],
								employeeId: targetEmployee.id,
								organizationId: targetEmployee.organizationId,
								snapshot: immediateSurchargeSnapshot,
							})
						: Promise.resolve(),
				"Failed to calculate surcharges after manual time entry",
				{ workPeriodId: createdWorkPeriod.id },
			);
		}

		if (shouldRunPostCommitEffects && !requiresApproval) {
			await markWorkBalanceDirtyAfterManualTimeEntryBestEffort(
				{
					employeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
					dirtyFromDate:
						DateTime.fromJSDate(adjustedClockIn, { zone: "utc" }).toISODate() ??
						undefined,
				},
				{
					employeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
					workPeriodId: createdWorkPeriod.id,
				},
			);
		}
		if (shouldRunPostCommitEffects) {
			await bestEffort(
				async () => revalidatePath("/time-tracking"),
				"Failed to revalidate time tracking after manual entry",
				{
					organizationId: targetEmployee.organizationId,
					workPeriodId: createdWorkPeriod.id,
				},
			);
		}

		logger.info(
			{
				workPeriodId: createdWorkPeriod.id,
				employeeId: targetEmployee.id,
				date: data.date,
				clockInTime: data.clockInTime,
				clockOutTime: data.clockOutTime,
				wasAdjusted,
				adjustedClockIn: wasAdjusted
					? adjustedClockIn.toISOString()
					: undefined,
				adjustedClockOut: wasAdjusted
					? adjustedClockOut.toISOString()
					: undefined,
				requiresApproval: requiresApproval && !approvalAutoCompleted,
			},
			"Manual time entry created successfully",
		);

		return {
			success: true,
			data: {
				workPeriodId: createdWorkPeriod.id,
				requiresApproval: requiresApproval && !approvalAutoCompleted,
				wasAdjusted: committedResultEvidence.wasAdjusted,
				adjustedTimes: committedResultEvidence.wasAdjusted
					? {
							clockIn: committedResultEvidence.startTime,
							clockOut: committedResultEvidence.endTime,
							durationMinutes: committedResultEvidence.durationMinutes,
						}
					: undefined,
			},
		};
	} catch (error) {
		if (
			error instanceof ValidationError &&
			Object.getPrototypeOf(error) !== ValidationError.prototype &&
			error.field === "managerId" &&
			error.message === "No manager assigned to approve time changes"
		) {
			return { success: false, error: error.message };
		}
		logger.error({ error }, "Failed to create manual time entry");
		return {
			success: false,
			error: "Failed to create time entry. Please try again.",
		};
	}
}
