import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime, IANAZone } from "luxon";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	approvalRequest,
	type employee,
	type timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workCategory,
	workPeriod,
} from "@/db/schema";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import {
	completeOrdinaryWorkPeriodDecisionAfterCommit,
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
} from "@/lib/approvals/server/work-period-approvals";
import {
	executeOrdinaryWorkPeriodSubmissionInTransaction,
	insertOrdinaryWorkPeriodSourceInTransaction,
	type WorkPeriodPostCommitDescriptor,
} from "@/lib/approvals/server/work-period-submission";
import { deriveApprovalWorkflowId } from "@/lib/approvals/workflow/identity";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import {
	employeeHasAccessToCategory,
	type WorkCategoryReader,
} from "@/lib/query/work-category.queries";
import {
	ClockingConflictError,
	clockingService,
	TimeEntryAppendReviewRequiredError,
} from "@/lib/time-tracking/clocking-service";
import {
	attributionIntent,
	type ClockChannel,
	clockSource,
	type CloseActiveWorkCommand,
	type CloseActiveWorkReceipt,
	CompletedWorkAttributionError,
	CompletedWorkCollisionError,
	closeActiveWork,
	replayCloseActiveWork,
	liveClockOutWriter,
} from "@/lib/time-tracking/close-active-work";
import {
	type CloseResumeWorkResult,
	closeAndResumeWork,
	replayCloseResumeWork,
} from "@/lib/time-tracking/close-resume-work";
import { resolvePolicyClockOutBreakSnapshotInTransaction } from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import {
	validateTimeEntry,
	validateTimeEntryRange,
} from "@/lib/time-tracking/validation";
import {
	isWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";
import { APPEND_REVIEW_REQUIRED_CODE } from "@/lib/time-tracking/time-clock-client";
import { withWebClockInTransaction } from "@/lib/time-tracking/web-clock-in-transaction";
import {
	type WorkTransactionContext,
	withWebClockOutTransaction,
} from "@/lib/time-tracking/web-clock-out-transaction";
import { WorkIntervalError } from "@/lib/time-tracking/work-duration";
import {
	assertNoUnresolvedWorkPeriodReview,
	isUnresolvedWorkPeriodReview,
} from "@/lib/time-tracking/work-period-review";
import { LiveWorkOccupiedError } from "@/lib/time-tracking/start-live-work";
import { acquireAdoptionGate, readAppendAdmission } from "@/lib/time-tracking/work-transaction";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { canonicalWorkRecordClient } from "../actions.canonical";
import {
	sendClockOutApprovalNotifications,
	sendClockOutApprovedNotification,
	sendManualEntryApprovalNotifications,
	sendManualEntryApprovedNotification,
} from "./approvals";
import {
	type CurrentEmployee,
	getCurrentEmployee,
	getCurrentSession,
	getUserTimezone,
} from "./auth";
import {
	calculateBreaksTakenToday,
	checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut,
	reconcileImmediateSurcharges,
} from "./compliance";
import {
	checkProjectBudgetAfterClockOut,
	createTimeEntry,
	validateProjectAssignment,
} from "./entry-helpers";
import {
	resolveManualEntryTarget,
	resolveManualEntryTargetZone,
} from "./manual-entry-target";
import {
	checkClockOutNeedsApproval,
	getEditCapabilityForPeriod,
} from "./policy-helpers";
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
	ClockOutResult,
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
// Ordinary users learn only that review is needed; operators get the scoped reasons.
const APPEND_REVIEW_REQUIRED_ERROR =
	"Your time history needs review before you can clock in. Please contact your administrator.";
const CLOCK_OUT_COLLISION_ERROR =
	"This clock-out conflicts with an earlier request or changed work. Please refresh and try again.";
const CLOCK_OUT_APPROVAL_UNSUPPORTED_ERROR =
	"Time changes requiring approval are not supported for this action yet";
const CLOCK_OUT_APPEND_REVIEW_REQUIRED_ERROR =
	"Your time history needs review before you can clock out. Please contact your administrator.";
const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type OrdinarySourceEvidence = Awaited<
	ReturnType<typeof db.query.workPeriod.findFirst>
> & {
	clockIn?: typeof timeEntry.$inferSelect | null;
	clockOut?: typeof timeEntry.$inferSelect | null;
};

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

function requireCanonicalSubmissionId(value: unknown): string {
	if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
		throw new Error("Invalid submission id");
	}
	return value;
}

function sameInstant(left: Date | null | undefined, right: Date): boolean {
	return left instanceof Date && left.getTime() === right.getTime();
}

function exactPlainObject(value: unknown, expectedKeys: readonly string[]) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new Error("Submission collision");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	const expectedKeySet = new Set(expectedKeys);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeySet.has(key))
	) {
		throw new Error("Submission collision");
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw new Error("Submission collision");
		}
		result[key] = descriptor.value;
	}
	return result;
}

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

function privateSubmissionMarker(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(
		value,
		"ordinarySubmission",
	);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Submission collision");
	}
	const marker = descriptor.value;
	if (
		!marker ||
		typeof marker !== "object" ||
		Array.isArray(marker) ||
		Object.getPrototypeOf(marker) !== Object.prototype
	) {
		throw new Error("Submission collision");
	}
	const descriptors = Object.getOwnPropertyDescriptors(marker);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== 2 ||
		keys.some(
			(key) =>
				typeof key !== "string" || (key !== "submissionId" && key !== "kind"),
		)
	) {
		throw new Error("Submission collision");
	}
	for (const key of ["submissionId", "kind"] as const) {
		const property = descriptors[key];
		if (!property?.enumerable || !("value" in property)) {
			throw new Error("Submission collision");
		}
	}
	return {
		submissionId: descriptors.submissionId.value,
		kind: descriptors.kind.value,
	};
}

function hasPrivateApprovalSubmissionEvidence(input: {
	metadata: unknown;
	expectedKey: string;
	submissionId: string;
	expectedKind: "manual_time_submission" | "policy_clock_out";
}): boolean {
	if (
		!input.metadata ||
		typeof input.metadata !== "object" ||
		Array.isArray(input.metadata)
	) {
		return false;
	}
	const metadataKeys = Reflect.ownKeys(
		Object.getOwnPropertyDescriptors(input.metadata),
	);
	const hasAutoApproval = metadataKeys.includes("autoApproval");
	const hasBreakPolicySnapshot = metadataKeys.includes("breakPolicySnapshot");
	const hasSurchargeSnapshot = metadataKeys.includes("surchargeSnapshot");
	if (
		!hasSurchargeSnapshot ||
		hasBreakPolicySnapshot !== (input.expectedKind === "policy_clock_out")
	) {
		throw new Error("Submission collision");
	}
	const root = exactPlainObject(
		input.metadata,
		hasAutoApproval
			? [
					"timeRequest",
					...(hasBreakPolicySnapshot ? ["breakPolicySnapshot"] : []),
					"surchargeSnapshot",
					"ordinarySubmission",
					"autoApproval",
				]
			: [
					"timeRequest",
					...(hasBreakPolicySnapshot ? ["breakPolicySnapshot"] : []),
					"surchargeSnapshot",
					"ordinarySubmission",
				],
	);
	const timeRequest = exactPlainObject(root.timeRequest, ["kind"]);
	if (timeRequest.kind !== input.expectedKind) {
		throw new Error("Submission collision");
	}
	if (hasAutoApproval) {
		const autoApproval = exactPlainObject(root.autoApproval, ["reason"]);
		if (autoApproval.reason !== "requester_is_approver") {
			throw new Error("Submission collision");
		}
	}
	const markerDescriptor = Object.getOwnPropertyDescriptor(
		root,
		"ordinarySubmission",
	);
	if (!markerDescriptor) return false;
	if (!markerDescriptor.enumerable || !("value" in markerDescriptor)) {
		throw new Error("Submission collision");
	}
	const marker = markerDescriptor.value;
	if (
		!marker ||
		typeof marker !== "object" ||
		Array.isArray(marker) ||
		Object.getPrototypeOf(marker) !== Object.prototype
	) {
		throw new Error("Submission collision");
	}
	const descriptors = Object.getOwnPropertyDescriptors(marker);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== 2 ||
		keys.some(
			(key) =>
				typeof key !== "string" || (key !== "key" && key !== "submissionId"),
		)
	) {
		throw new Error("Submission collision");
	}
	for (const key of ["key", "submissionId"] as const) {
		const property = descriptors[key];
		if (!property?.enumerable || !("value" in property)) {
			throw new Error("Submission collision");
		}
	}
	if (
		descriptors.key.value !== input.expectedKey ||
		descriptors.submissionId.value !== input.submissionId
	) {
		throw new Error("Submission collision");
	}
	return true;
}

function requireReplayOnlySubmission<
	T extends {
		disposition: "executed" | "replayed";
		postCommit: WorkPeriodPostCommitDescriptor | null;
	},
>(submission: T): T {
	if (submission.disposition !== "replayed" || submission.postCommit !== null) {
		throw new Error("Submission collision");
	}
	return submission;
}

async function loadCanonicalEvidence(
	tx: Pick<typeof db, "query">,
	period: OrdinarySourceEvidence,
	organizationId: string,
) {
	if (!period?.canonicalRecordId) throw new Error("Submission collision");
	const [record, workRows, allocations] = await Promise.all([
		tx.query.timeRecord.findFirst({
			where: and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, organizationId),
			),
		}),
		tx.query.timeRecordWork.findMany({
			where: and(
				eq(timeRecordWork.recordId, period.canonicalRecordId),
				eq(timeRecordWork.organizationId, organizationId),
			),
			limit: 2,
		}),
		tx.query.timeRecordAllocation.findMany({
			where: and(
				eq(timeRecordAllocation.recordId, period.canonicalRecordId),
				eq(timeRecordAllocation.organizationId, organizationId),
			),
			limit: 2,
		}),
	]);
	return { record, workRows, allocations };
}

function validateCommonEvidence(input: {
	period: OrdinarySourceEvidence;
	canonical: Awaited<ReturnType<typeof loadCanonicalEvidence>>;
	organizationId: string;
	employeeId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	origin: "clock" | "manual";
}) {
	const { period, canonical } = input;
	const work = canonical.workRows[0];
	const allocation = canonical.allocations[0];
	const expectedProjectId = period.projectId ?? null;
	if (
		!period ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.employeeId ||
		period.isActive !== false ||
		period.deletedAt !== null ||
		!period.clockIn ||
		!period.clockOut ||
		period.clockIn.id !== period.clockInId ||
		period.clockOut.id !== period.clockOutId ||
		period.clockIn.organizationId !== input.organizationId ||
		period.clockOut.organizationId !== input.organizationId ||
		period.clockIn.employeeId !== input.employeeId ||
		period.clockOut.employeeId !== input.employeeId ||
		period.clockIn.type !== "clock_in" ||
		period.clockOut.type !== "clock_out" ||
		!sameInstant(period.startTime, input.startTime) ||
		!sameInstant(period.endTime, input.endTime) ||
		!sameInstant(period.clockIn.timestamp, input.startTime) ||
		!sameInstant(period.clockOut.timestamp, input.endTime) ||
		period.durationMinutes !== input.durationMinutes ||
		!canonical.record ||
		canonical.record.id !== period.canonicalRecordId ||
		canonical.record.organizationId !== input.organizationId ||
		canonical.record.employeeId !== input.employeeId ||
		canonical.record.recordKind !== "work" ||
		canonical.record.origin !== input.origin ||
		canonical.record.approvalState !== period.approvalStatus ||
		!sameInstant(canonical.record.startAt, input.startTime) ||
		!sameInstant(canonical.record.endAt, input.endTime) ||
		canonical.record.durationMinutes !== input.durationMinutes ||
		canonical.workRows.length !== 1 ||
		!work ||
		work.recordId !== period.canonicalRecordId ||
		work.organizationId !== input.organizationId ||
		work.recordKind !== "work" ||
		work.workCategoryId !== (period.workCategoryId ?? null) ||
		work.workLocationType !== (period.workLocationType ?? null) ||
		(input.origin === "clock" && work.computationMetadata !== null) ||
		(expectedProjectId === null
			? canonical.allocations.length !== 0
			: canonical.allocations.length !== 1 ||
				!allocation ||
				allocation.recordId !== period.canonicalRecordId ||
				allocation.organizationId !== input.organizationId ||
				allocation.allocationKind !== "project" ||
				allocation.projectId !== expectedProjectId ||
				allocation.costCenterId !== null ||
				allocation.weightPercent !== 100)
	) {
		throw new Error("Submission collision");
	}
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

async function findPolicyClockOutSubmissionEvidence(input: {
	tx: Pick<typeof db, "query">;
	submissionId: string;
	organizationId: string;
	employeeId: string;
	projectId: string | null;
	workCategoryId: string | null;
}) {
	const periods = (await input.tx.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, input.organizationId),
			eq(workPeriod.employeeId, input.employeeId),
			eq(workPeriod.isActive, false),
			eq(workPeriod.clockOutId, input.submissionId),
		),
		with: { clockIn: true, clockOut: true },
		limit: 2,
	})) as OrdinarySourceEvidence[];
	if (periods.length === 0) return null;
	if (periods.length !== 1) throw new Error("Submission collision");
	const period = periods[0];
	if (
		!(period.startTime instanceof Date) ||
		!(period.endTime instanceof Date)
	) {
		throw new Error("Submission collision");
	}
	const canonical = await loadCanonicalEvidence(
		input.tx,
		period,
		input.organizationId,
	);
	validateCommonEvidence({
		period,
		canonical,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startTime: period.startTime,
		endTime: period.endTime,
		durationMinutes: period.durationMinutes ?? -1,
		origin: "clock",
	});
	const marker = privateSubmissionMarker(period.pendingChanges);
	const submissionKey = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "policy_clock_out",
		sourceType: "time_entry",
		sourceId: period.id,
		allocationKey: input.submissionId,
	});
	const expectedWorkflowId = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "policy_clock_out",
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
				expectedKind: "policy_clock_out",
			}),
		);
		hasApprovalEvidence = requestEvidence.some(Boolean);
	}
	if (period.approvalStatus === "pending" && !hasApprovalEvidence) {
		throw new Error("Submission collision");
	}
	if (
		period.projectId !== input.projectId ||
		period.workCategoryId !== input.workCategoryId ||
		(marker !== null &&
			(marker.submissionId !== input.submissionId ||
				marker.kind !== "policy_clock_out"))
	) {
		throw new Error("Submission collision");
	}
	return { period, marker, hasApprovalEvidence };
}

export function createOrdinaryApprovalRuntime(
	database: ApprovalWorkflowDatabase = db,
) {
	return createProductionApprovalWorkflowRuntime({
		db: database,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => {
					throw new Error("Absence finalization is outside time tracking");
				},
				deleteCancelledAbsence: async () => {
					throw new Error("Absence cancellation is outside time tracking");
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal: async () => {
					throw new Error(
						"Time correction finalization is outside time tracking",
					);
				},
				deleteCancelledCorrections: async () => {
					throw new Error(
						"Time correction cancellation is outside time tracking",
					);
				},
			},
			ordinaryWorkPeriod: {
				finalizeTerminal:
					finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		canManageApproval: async () => false,
		clock: systemClock,
	});
}

function approvalDbServiceForTransaction(dbService: {
	db: unknown;
}): ApprovalDbService {
	return {
		db: dbService.db as ApprovalDbService["db"],
		query: <T>(_name: string, operation: () => Promise<T>) =>
			Effect.promise(operation),
	};
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
	instant?: Instant;
	deviceInfo?: ClockChannel;
};

/** An authenticated human clocking their own employee record. */
export type ClockActor = {
	userId: string;
	employee: CurrentEmployee;
	/**
	 * Fallback zone for the event capture when the adapter supplies no browser
	 * zone: the web uses the saved user setting, bots their temporal context.
	 */
	resolveTimezone(): Promise<string>;
};

/**
 * Why a shared clock command did not commit, so each adapter can word it.
 * `unconfirmed` is the only outcome where work may have been saved: an
 * unexpected failure while the transaction was open or committing.
 */
export type ClockCommandFailure =
	| "not_clocked_in"
	| "already_clocked_in"
	| "rejected"
	| "billing_required"
	| "approval_required"
	| "approval_unavailable"
	| "append_review_required"
	| "collision"
	| "failed"
	| "unconfirmed";

export type ClockCommandResult<T, Committed = unknown> =
	| ({ success: true; data: T } & Committed)
	| {
			success: false;
			error: string;
			code?: string;
			holidayName?: string;
			failure: ClockCommandFailure;
	  };

/** The web action wire shape, without adapter-only outcome detail. */
function toActionResult<T>(
	result: ClockCommandResult<T>,
): ServerActionResult<T> {
	if (result.success) return { success: true, data: result.data };
	const { failure: _failure, ...failed } = result;
	return failed;
}

async function markWorkBalanceDirtyAfterClockOutBestEffort(
	input: WorkBalanceDirtyInput,
	context: Record<string, unknown>,
) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error(
			{ error, ...context },
			"Failed to mark work balance dirty after clock-out",
		);
	}
}

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
	const category = await reader.query.workCategory.findFirst({
		where: and(
			eq(workCategory.id, workCategoryId),
			eq(workCategory.organizationId, organizationId),
			eq(workCategory.isActive, true),
		),
	});
	if (!category) {
		return { isValid: false, error: "Work category not found" };
	}
	return (await employeeHasAccessToCategory(
		employeeId,
		workCategoryId,
		organizationId,
		reader,
		now,
	))
		? { isValid: true }
		: { isValid: false, error: "Cannot assign to this work category" };
}

export async function clockIn(
	workLocationType?: WorkLocationType,
	actionContext: ClockActionContext = {},
): Promise<ServerActionResult<Awaited<ReturnType<typeof createTimeEntry>>>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	return toActionResult(
		await clockInAs(
			webClockActor(session.user.id, currentEmployee),
			workLocationType,
			actionContext,
		),
	);
}

function webClockActor(
	userId: string,
	employee: CurrentEmployee,
): ClockActor {
	return { userId, employee, resolveTimezone: () => getUserTimezone(userId) };
}

/**
 * Shared live clock-in for an adapter-authenticated actor (web, mobile, bots).
 * Every channel starts work through the same coordinated transaction, so an
 * adopted organization's append lineage has one clock-in writer (#273, #277).
 */
export async function clockInAs(
	actor: ClockActor,
	workLocationType?: WorkLocationType,
	actionContext: ClockActionContext = {},
): Promise<
	ClockCommandResult<Awaited<ReturnType<typeof createTimeEntry>>>
> {
	const currentEmployee = actor.employee;
	const [timezone, activeWorkPeriod] = await Promise.all([
		actor.resolveTimezone(),
		getActiveWorkPeriod(currentEmployee.id),
	]);
	if (activeWorkPeriod) {
		return {
			success: false,
			error: "You are already clocked in",
			failure: "already_clocked_in",
		};
	}

	const actionInstant = actionContext.instant ?? systemClock.nowInstant();
	const now = dateFromInstant(actionInstant);
	const validation = await validateTimeEntry(
		currentEmployee.organizationId,
		now,
		timezone,
	);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock in at this time",
			holidayName: validation.holidayName,
			failure: "rejected",
		};
	}

	const resolvedWorkLocationType = workLocationType ?? "office";

	if (!isWorkLocationType(resolvedWorkLocationType)) {
		return {
			success: false,
			error: "Invalid work location type",
			failure: "rejected",
		};
	}

	const billingAccess = await requireBillingForMutation(
		currentEmployee.organizationId,
	);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
			failure: "billing_required",
		};
	}

	try {
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: now,
			browserTimezone: actionContext.browserTimezone,
			fallbackTimezone: timezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
		const { entry } = await withWebClockInTransaction(
			{
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				userId: actor.userId,
			},
			(coordination) =>
				clockingService.clockIn({
					coordination,
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					createdBy: actor.userId,
					action: { instant: actionInstant, ...timezoneCapture },
					source: clockSource(actionContext.deviceInfo ?? "web"),
					workLocationType: resolvedWorkLocationType,
				}),
		);

		return {
			success: true,
			data: entry as Awaited<ReturnType<typeof createTimeEntry>>,
		};
	} catch (error) {
		if (error instanceof ClockingConflictError) {
			return {
				success: false,
				error: "You are already clocked in",
				failure: "already_clocked_in",
			};
		}
		if (error instanceof LiveWorkOccupiedError) {
			return {
				success: false,
				error: "This time overlaps other recorded work",
				code: "occupancy_conflict",
				failure: "rejected",
			};
		}
		if (error instanceof TimeEntryAppendReviewRequiredError) {
			logger.warn(
				{ appendReviewRequirement: error.requirement },
				"Clock in held for append history review",
			);
			return {
				success: false,
				error: APPEND_REVIEW_REQUIRED_ERROR,
				code: APPEND_REVIEW_REQUIRED_CODE,
				failure: "append_review_required",
			};
		}
		logger.error({ error }, "Clock in error");
		return {
			success: false,
			error: "Failed to clock in. Please try again.",
			failure: "unconfirmed",
		};
	}
}

/** The original committed result; current approval state is a separate read. */
function receiptResponse(receipt: CloseActiveWorkReceipt): ClockOutResult {
	const { approval } = receipt.result;
	return {
		...(receipt.entry as ClockOutResult),
		pendingApproval:
			approval.participation === "policy_clock_out"
				? approval.outcome !== "auto_completed"
				: undefined,
	};
}

/** Post-commit facts of one executed or legacy-replayed live closure. */
export type ClockOutCommitOutcome = {
	entry: unknown;
	disposition: "executed" | "replayed";
	durationMinutes: number;
	approvalSubmission:
		| {
				result: { kind: string };
				disposition: "executed" | "replayed";
				postCommit: WorkPeriodPostCommitDescriptor | null;
		  }
		| undefined;
	workPeriodId: string;
	startTime: Date;
	endTime: Date;
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	/** True when the closure committed its own work-balance refresh intent. */
	balanceRefreshCommitted: boolean;
};

/**
 * Post-commit work shared by every live clock-out adapter: approval
 * notification dispatch through the approval owner, then the best-effort
 * compliance, break, surcharge, balance, budget and cache follow-ups. None of
 * them can turn the committed closure into a failure.
 */
export async function completeClockOutAfterCommit(input: {
	outcome: ClockOutCommitOutcome;
	employee: { id: string; organizationId: string };
	userId: string;
	needsClockOutApproval: boolean;
	timezone: string;
	projectId: string | null | undefined;
}): Promise<ClockOutResult> {
	const { outcome, employee, userId, needsClockOutApproval, timezone, projectId } =
		input;
	const entry = outcome.entry as Awaited<ReturnType<typeof createTimeEntry>>;
	const { durationMinutes, approvalSubmission, workPeriodId } = outcome;
	const approvalResult = approvalSubmission?.result;
	const approvalAutoCompleted = approvalResult?.kind === "auto_completed";
	if (
		needsClockOutApproval &&
		approvalSubmission?.disposition === "executed"
	) {
		await completeOrdinaryWorkPeriodDecisionAfterCommit({
			execute: async () => approvalSubmission,
			dispatchPending: true,
			dispatch: async (execution) => {
				const descriptor = execution.postCommit;
				const managerId = descriptor?.approverEmployeeId;
				if (!descriptor) return;
				if (!managerId) {
					logger.warn(
						{ organizationId: employee.organizationId },
						"Clock-out approval has no notification recipient",
					);
					return;
				}
				const params = {
					workPeriodId: workPeriodId,
					employeeId: employee.id,
					managerId,
					organizationId: employee.organizationId,
					startTime: outcome.startTime,
					endTime: outcome.endTime,
					durationMinutes,
					dedupeKey: descriptor.dedupeKey,
				};
				await (descriptor.event === "approved"
					? sendClockOutApprovedNotification(params)
					: sendClockOutApprovalNotifications(params));
			},
			maintain: reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
			onDispatchError: (error) =>
				logger.error(
					{
						error,
						organizationId: employee.organizationId,
						workPeriodId: workPeriodId,
					},
					"Failed to dispatch clock-out approval notification after commit",
				),
			onMaintenanceError: (error) =>
				logger.error(
					{
						error,
						organizationId: employee.organizationId,
						workPeriodId: workPeriodId,
					},
					"Failed to reconcile clock-out approval maintenance after commit",
				),
		});
	}

	const shouldRunPostCommitEffects =
		outcome.disposition === "executed" &&
		(!needsClockOutApproval ||
			approvalSubmission?.disposition === "executed");
	let complianceWarnings: Awaited<
		ReturnType<typeof checkComplianceAfterClockOut>
	> = [];
	if (shouldRunPostCommitEffects) {
		await bestEffort(
			async () => {
				complianceWarnings = await checkComplianceAfterClockOut(
					employee.id,
					employee.organizationId,
					workPeriodId,
					durationMinutes,
					timezone,
				);
			},
			"Failed to check compliance after clock-out",
			{ workPeriodId: workPeriodId },
		);
	}

	let breakEnforcementResult: Awaited<
		ReturnType<typeof enforceBreaksAfterClockOut>
	> = {
		wasAdjusted: false,
		affectedWorkPeriodIds: [workPeriodId],
	};
	if (shouldRunPostCommitEffects && !needsClockOutApproval) {
		await bestEffort(
			async () => {
				breakEnforcementResult = await enforceBreaksAfterClockOut({
					employeeId: employee.id,
					organizationId: employee.organizationId,
					workPeriodId: workPeriodId,
					sessionDurationMinutes: durationMinutes,
					timezone,
					createdBy: userId,
				});
			},
			"Failed to enforce breaks after clock-out",
			{ workPeriodId: workPeriodId },
		);
	}
	if (shouldRunPostCommitEffects && !needsClockOutApproval) {
		await bestEffort(
			() =>
				outcome.surchargeSnapshot
					? reconcileImmediateSurcharges({
							affectedWorkPeriodIds:
								breakEnforcementResult.affectedWorkPeriodIds,
							employeeId: employee.id,
							organizationId: employee.organizationId,
							snapshot: outcome.surchargeSnapshot,
						})
					: Promise.resolve(),
			"Failed to calculate surcharges after clock-out",
			{ workPeriodId: workPeriodId },
		);
	}

	// The operation commits this refresh intent with the work itself.
	if (
		shouldRunPostCommitEffects &&
		!needsClockOutApproval &&
		!outcome.balanceRefreshCommitted
	) {
		await markWorkBalanceDirtyAfterClockOutBestEffort(
			{
				employeeId: employee.id,
				organizationId: employee.organizationId,
				dirtyFromDate:
					instantFromDate(outcome.startTime)
						.toZonedDateTimeISO("UTC")
						.toPlainDate()
						.toString(),
			},
			{
				employeeId: employee.id,
				organizationId: employee.organizationId,
				workPeriodId: workPeriodId,
			},
		);
	}

	if (projectId && shouldRunPostCommitEffects) {
		void checkProjectBudgetAfterClockOut(
			projectId,
			employee.organizationId,
		).catch((error) => {
			logger.error(
				{ error, projectId },
				"Failed to check project budget warnings",
			);
		});
	}
	if (shouldRunPostCommitEffects) {
		await bestEffort(
			async () => revalidatePath("/time-tracking"),
			"Failed to revalidate time tracking after clock-out",
			{
				organizationId: employee.organizationId,
				workPeriodId: workPeriodId,
			},
		);
	}

	return {
		...entry,
		pendingApproval: approvalSubmission ? !approvalAutoCompleted : undefined,
		complianceWarnings:
			complianceWarnings.length > 0 ? complianceWarnings : undefined,
		breakAdjustment: breakEnforcementResult.wasAdjusted
			? breakEnforcementResult.adjustment
			: undefined,
	};
}

/**
 * Web clock-out. `undefined` attribution preserves the active period's project or
 * category; `null` clears it explicitly (adopted operation path). Organizations
 * whose append control is active close through the completed-work operation;
 * the others keep the #272 legacy closure until activation.
 */
export async function clockOut(
	projectId: string | null | undefined,
	workCategoryId: string | null | undefined,
	actionContext: ClockOutActionContext,
): Promise<ServerActionResult<ClockOutResult>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	return toActionResult(
		await clockOutAs(
			webClockActor(session.user.id, currentEmployee),
			projectId,
			workCategoryId,
			actionContext,
		),
	);
}

export type ClockOutOptions = {
	/**
	 * Rejects a closure the policy routes to approval, before any write. Bots
	 * set it: approval-routed clock-out stays unsupported there (#277).
	 */
	refuseApprovalRouting?: boolean;
};

/**
 * Shared live clock-out for an adapter-authenticated actor (web, mobile, bots).
 * The committed result carries the stored duration for adapters that report it.
 */
export async function clockOutAs(
	actor: ClockActor,
	projectId: string | null | undefined,
	workCategoryId: string | null | undefined,
	actionContext: ClockOutActionContext,
	options: ClockOutOptions = {},
): Promise<
	ClockCommandResult<ClockOutResult, { durationMinutes: number | null }>
> {
	const currentEmployee = actor.employee;
	let submissionId: string;
	try {
		submissionId = requireCanonicalSubmissionId(actionContext?.submissionId);
	} catch {
		return {
			success: false,
			error: "Failed to clock out. Please try again.",
			failure: "rejected",
		};
	}
	const command: CloseActiveWorkCommand = {
		version: 1,
		operationId: submissionId,
		project: attributionIntent(projectId),
		workCategory: attributionIntent(workCategoryId),
		requestedInstant: actionContext.instant
			? instantToCanonicalString(actionContext.instant)
			: null,
		browserTimezone: actionContext.browserTimezone ?? null,
		deviceInfo: actionContext.deviceInfo ?? "web",
	};
	const writer = liveClockOutWriter(command.deviceInfo);
	const operationScope = {
		organizationId: currentEmployee.organizationId,
		employeeId: currentEmployee.id,
		command,
		writer: writer.writer,
	};

	/** Receipt-less committed clock-outs keep their exact legacy matching rules. */
	const replayLegacyClockOut = async (coordination: WorkTransactionContext) => {
		const context = coordination.approval;
		const evidence = await findPolicyClockOutSubmissionEvidence({
			tx: coordination.db,
			submissionId,
			organizationId: currentEmployee.organizationId,
			employeeId: currentEmployee.id,
			projectId: projectId ?? null,
			workCategoryId: workCategoryId ?? null,
		});
		if (!evidence) return null;
		const { period, hasApprovalEvidence } = evidence;
		if (!hasApprovalEvidence) return { period, approvalSubmission: null };
		const approvalSubmission = requireReplayOnlySubmission(
			await executeOrdinaryWorkPeriodSubmissionInTransaction({
				dbService: approvalDbServiceForTransaction(context.dbService),
				context,
				coordination,
				organizationId: currentEmployee.organizationId,
				workPeriodId: period.id,
				submissionId,
				requesterEmployeeId: currentEmployee.id,
				requesterUserId: actor.userId,
				teamId: currentEmployee.teamId,
				defaultApproverId: null,
				reason: "Clock-out requires approval (0-day policy)",
				overtimeRisk: "warning",
				kind: "policy_clock_out",
				metadata: {},
			}),
		);
		return { period, approvalSubmission };
	};
	const legacyReplayResponse = (
		replay: NonNullable<Awaited<ReturnType<typeof replayLegacyClockOut>>>,
	): ClockOutResult => ({
		...(replay.period.clockOut as ClockOutResult),
		pendingApproval: replay.approvalSubmission
			? replay.approvalSubmission.result.kind !== "auto_completed"
			: undefined,
	});

	try {
		const replay = await withWebClockOutTransaction(
			{
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				userId: actor.userId,
				submissionId,
			},
			createOrdinaryApprovalRuntime,
			async (coordination) => {
				// Receipts precede the legacy matcher in every mode, so a later mode
				// rollback still replays committed operations exactly.
				const receipt = await replayCloseActiveWork(coordination, operationScope);
				if (receipt) {
					return {
						data: receiptResponse(receipt),
						durationMinutes: receipt.result.segment.durationMinutes,
					};
				}
				const legacy = await replayLegacyClockOut(coordination);
				return legacy
					? {
							data: legacyReplayResponse(legacy),
							durationMinutes: legacy.period.durationMinutes ?? null,
						}
					: null;
			},
		);
		if (replay) return { success: true, ...replay };
	} catch (error) {
		if (error instanceof CompletedWorkCollisionError) {
			logger.warn({ error }, "Clock out identity collision");
			return {
				success: false,
				error: CLOCK_OUT_COLLISION_ERROR,
				failure: "collision",
			};
		}
		logger.error({ error }, "Clock out replay error");
		// The replay transaction only reads, so this attempt wrote nothing.
		return {
			success: false,
			error: "Failed to clock out. Please try again.",
			failure: "failed",
		};
	}

	const [timezone, activeWorkPeriod] = await Promise.all([
		actor.resolveTimezone(),
		getActiveWorkPeriod(currentEmployee.id),
	]);
	if (!activeWorkPeriod) {
		return {
			success: false,
			error: "You are not currently clocked in",
			failure: "not_clocked_in",
		};
	}

	const actionInstant = actionContext.instant ?? systemClock.nowInstant();
	const now = dateFromInstant(actionInstant);
	const validation = await validateTimeEntry(
		currentEmployee.organizationId,
		now,
		timezone,
	);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock out at this time",
			holidayName: validation.holidayName,
			failure: "rejected",
		};
	}

	if (projectId) {
		const projectValidation = await validateProjectAssignment(
			projectId,
			currentEmployee.id,
			currentEmployee.teamId,
			currentEmployee.organizationId,
		);

		if (!projectValidation.isValid) {
			return {
				success: false,
				error: projectValidation.error || "Cannot assign to this project",
				failure: "rejected",
			};
		}
	}
	if (workCategoryId) {
		const categoryValidation = await validateWorkCategoryAssignment(
			currentEmployee.id,
			workCategoryId,
			currentEmployee.organizationId,
		);
		if (!categoryValidation.isValid) {
			return {
				success: false,
				error:
					categoryValidation.error || "Cannot assign to this work category",
				failure: "rejected",
			};
		}
	}

	const billingAccess = await requireBillingForMutation(
		currentEmployee.organizationId,
	);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
			failure: "billing_required",
		};
	}

	let needsClockOutApproval = false;
	try {
		needsClockOutApproval = await checkClockOutNeedsApproval(
			currentEmployee.id,
		);
	} catch (error) {
		logger.warn({ error }, "Failed to check clock-out approval requirement");
		return {
			success: false,
			error: APPROVAL_POLICY_CHECK_ERROR,
			failure: "approval_unavailable",
		};
	}
	if (needsClockOutApproval && options.refuseApprovalRouting) {
		return {
			success: false,
			error: CLOCK_OUT_APPROVAL_UNSUPPORTED_ERROR,
			failure: "approval_required",
		};
	}

	// Set once the closure has committed: a later failure must not report the
	// saved work as unsaved.
	let committed: { data: ClockOutResult; durationMinutes: number } | null =
		null;
	try {
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: now,
			browserTimezone: actionContext.browserTimezone,
			fallbackTimezone: timezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
		let immediateSurchargeSnapshot: PolicyClockOutSurchargeSnapshot | null =
			null;
		// #272 prefactor closure, kept for organizations that have not adopted.
		const closeLegacyClockOut = async (coordination: WorkTransactionContext) => {
			const context = coordination.approval;
			const clockOutResult = await clockingService.clockOut({
				coordination,
				actionId: submissionId,
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				workPeriodId: activeWorkPeriod.id,
				createdBy: actor.userId,
				action: { instant: actionInstant, ...timezoneCapture },
				source: clockSource(actionContext.deviceInfo ?? "web"),
				projectId,
				workCategoryId,
				approvalStatus: needsClockOutApproval ? "pending" : "approved",
				// The canonical record and policy evidence reuse the closer's locked
				// start and derived duration, so both representations agree (#388).
				beforePeriodClose: async ({ activePeriod, durationMinutes }) => {
					const breakPolicySnapshot = needsClockOutApproval
						? await resolvePolicyClockOutBreakSnapshotInTransaction({
								dbService: { db: coordination.db },
								organizationId: currentEmployee.organizationId,
								employeeId: currentEmployee.id,
								endTime: actionInstant,
							})
						: null;
					const surchargeSnapshot =
						await resolvePolicyClockOutSurchargeSnapshotInTransaction({
							dbService: { db: coordination.db },
							organizationId: currentEmployee.organizationId,
							employeeId: currentEmployee.id,
							startTime: instantFromDate(activePeriod.startTime),
							endTime: actionInstant,
						});
					if (!needsClockOutApproval)
						immediateSurchargeSnapshot = surchargeSnapshot;
					const canonicalRecord =
						await canonicalWorkRecordClient.createForCompletedPeriod(
							{
								organizationId: currentEmployee.organizationId,
								employeeId: currentEmployee.id,
								startAt: activePeriod.startTime,
								endAt: now,
								durationMinutes,
								approvalState: needsClockOutApproval ? "pending" : "approved",
								createdBy: actor.userId,
								workCategoryId: workCategoryId ?? null,
								workLocationType: activeWorkPeriod.workLocationType ?? null,
								projectId: projectId ?? null,
								origin: "clock",
							},
							coordination.db,
						);
					return {
						canonicalRecordId: canonicalRecord.id,
						pendingChanges:
							breakPolicySnapshot && surchargeSnapshot
								? {
										originalStartTime: activePeriod.startTime.toISOString(),
										originalEndTime: now.toISOString(),
										originalDurationMinutes: durationMinutes,
										requestedAt: now.toISOString(),
										requestedBy: actor.userId,
										isNewClockOut: true,
										ordinarySubmission: {
											submissionId,
											kind: "policy_clock_out" as const,
										},
										breakPolicySnapshot,
										surchargeSnapshot,
									}
								: null,
					};
				},
				afterPeriodClose: needsClockOutApproval
					? async ({ transaction }) => {
							if (transaction !== context.dbService.db) {
								throw new Error("Clock-out transaction context changed");
							}
							return executeOrdinaryWorkPeriodSubmissionInTransaction({
								dbService: approvalDbServiceForTransaction(context.dbService),
								context,
								coordination,
								organizationId: currentEmployee.organizationId,
								workPeriodId: activeWorkPeriod.id,
								submissionId: requireCanonicalSubmissionId(submissionId),
								requesterEmployeeId: currentEmployee.id,
								requesterUserId: actor.userId,
								teamId: currentEmployee.teamId,
								defaultApproverId: null,
								reason: "Clock-out requires approval (0-day policy)",
								overtimeRisk: "warning",
								kind: "policy_clock_out",
								metadata: {},
							});
						}
					: undefined,
			});
			if (clockOutResult.disposition !== "replayed") {
				return clockOutResult;
			}
			const replayEvidence = await findPolicyClockOutSubmissionEvidence({
				tx: coordination.db,
				submissionId,
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				projectId: projectId ?? null,
				workCategoryId: workCategoryId ?? null,
			});
			if (
				!replayEvidence ||
				replayEvidence.period.id !== clockOutResult.period.id
			) {
				throw new Error("Submission collision");
			}
			if (!replayEvidence.hasApprovalEvidence) return clockOutResult;
			const transactionResult = requireReplayOnlySubmission(
				await executeOrdinaryWorkPeriodSubmissionInTransaction({
					dbService: approvalDbServiceForTransaction(context.dbService),
					context,
					organizationId: currentEmployee.organizationId,
					workPeriodId: clockOutResult.period.id,
					coordination,
					submissionId: requireCanonicalSubmissionId(submissionId),
					requesterEmployeeId: currentEmployee.id,
					requesterUserId: actor.userId,
					teamId: currentEmployee.teamId,
					defaultApproverId: null,
					reason: "Clock-out requires approval (0-day policy)",
					overtimeRisk: "warning",
					kind: "policy_clock_out",
					metadata: {},
				}),
			);
			return { ...clockOutResult, transactionResult };
		};
		const result = await withWebClockOutTransaction(
			{
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				userId: actor.userId,
				submissionId,
				workPeriodId: activeWorkPeriod.id,
				endTime: actionInstant,
				requiresApproval: needsClockOutApproval,
				projectId,
				workCategoryId,
			},
			createOrdinaryApprovalRuntime,
			async (coordination) => {
				const receipt = await replayCloseActiveWork(coordination, operationScope);
				if (receipt) {
					return {
						kind: "replayed" as const,
						data: receiptResponse(receipt),
						durationMinutes: receipt.result.segment.durationMinutes,
					};
				}
				if (coordination.admission !== "append") {
					return {
						kind: "legacy" as const,
						closed: await closeLegacyClockOut(coordination),
					};
				}
				const legacyReplay = await replayLegacyClockOut(coordination);
				if (legacyReplay) {
					return {
						kind: "replayed" as const,
						data: legacyReplayResponse(legacyReplay),
						durationMinutes: legacyReplay.period.durationMinutes ?? null,
					};
				}
				return {
					kind: "operation" as const,
					closed: await closeActiveWork(coordination, {
						organizationId: currentEmployee.organizationId,
						employeeId: currentEmployee.id,
						teamId: currentEmployee.teamId,
						actorUserId: actor.userId,
						workPeriodId: activeWorkPeriod.id,
						command,
						writer,
						eventInstant: actionInstant,
						capture: timezoneCapture,
					}),
				};
			},
		);
		if (result.kind === "replayed") {
			return {
				success: true,
				data: result.data,
				durationMinutes: result.durationMinutes,
			};
		}
		// One shape for post-commit work. The operation reports its committed
		// receipt facts; the legacy closure keeps its preflight snapshot facts.
		const outcome =
			result.kind === "operation"
				? {
						entry: result.closed.entry,
						disposition: result.closed.disposition,
						durationMinutes: result.closed.result.segment.durationMinutes,
						approvalSubmission: result.closed.approvalSubmission ?? undefined,
						workPeriodId: result.closed.result.workPeriodId,
						startTime: dateFromInstant(
							parseInstant(result.closed.result.segment.startAt),
						),
						endTime: dateFromInstant(
							parseInstant(result.closed.result.segment.endAt),
						),
						surchargeSnapshot: result.closed.surchargeSnapshot,
						balanceRefreshCommitted: true,
					}
				: {
						entry: result.closed.entry,
						disposition: result.closed.disposition,
						durationMinutes: result.closed.durationMinutes,
						approvalSubmission: result.closed.transactionResult as
							| {
									result: { kind: string };
									disposition: "executed" | "replayed";
									postCommit: WorkPeriodPostCommitDescriptor | null;
							  }
							| undefined,
						workPeriodId: activeWorkPeriod.id,
						startTime: activeWorkPeriod.startTime,
						endTime: now,
						surchargeSnapshot:
							immediateSurchargeSnapshot as PolicyClockOutSurchargeSnapshot | null,
						balanceRefreshCommitted: false,
					};
		// From here the closure is committed: a later failure must not report the
		// saved work as unsaved.
		committed = {
			data: {
				...(outcome.entry as ClockOutResult),
				pendingApproval: outcome.approvalSubmission
					? outcome.approvalSubmission.result.kind !== "auto_completed"
					: undefined,
			},
			durationMinutes: outcome.durationMinutes,
		};
		return {
			success: true,
			data: await completeClockOutAfterCommit({
				outcome,
				employee: currentEmployee,
				userId: actor.userId,
				needsClockOutApproval,
				timezone,
				projectId,
			}),
			durationMinutes: outcome.durationMinutes,
		};
	} catch (error) {
		if (committed) {
			logger.error({ error }, "Clock out post-commit error");
			return { success: true, ...committed };
		}
		if (error instanceof ClockingConflictError) {
			return {
				success: false,
				error: "You are not currently clocked in",
				failure: "not_clocked_in",
			};
		}
		if (error instanceof WorkIntervalError) {
			return {
				success: false,
				error: "Clock-out must be after clock-in",
				failure: "rejected",
			};
		}
		if (error instanceof CompletedWorkCollisionError) {
			logger.warn({ error }, "Clock out identity collision");
			return {
				success: false,
				error: CLOCK_OUT_COLLISION_ERROR,
				failure: "collision",
			};
		}
		if (error instanceof CompletedWorkAttributionError) {
			return {
				success: false,
				error:
					error.field === "projectId"
						? "Cannot assign to this project"
						: "Cannot assign to this work category",
				failure: "rejected",
			};
		}
		if (error instanceof TimeEntryAppendReviewRequiredError) {
			logger.warn(
				{ appendReviewRequirement: error.requirement },
				"Clock out held for append history review",
			);
			return {
				success: false,
				error: CLOCK_OUT_APPEND_REVIEW_REQUIRED_ERROR,
				failure: "append_review_required",
			};
		}
		if (
			error instanceof ValidationError &&
			Object.getPrototypeOf(error) !== ValidationError.prototype &&
			error.field === "managerId" &&
			error.message === "No manager assigned to approve time changes"
		) {
			return {
				success: false,
				error: error.message,
				failure: "approval_unavailable",
			};
		}
		logger.error({ error }, "Clock out error");
		return {
			success: false,
			error: "Failed to clock out. Please try again.",
			failure: "unconfirmed",
		};
	}
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

type AddBreakCommand = {
	version: 1;
	operationId: string;
	breakMinutes: number;
	browserTimezone: string | null;
	deviceInfo: "web";
};

const ADD_BREAK_FAILED_ERROR = "Failed to add break. Please try again.";

/** The resumed work a committed break reports, from its receipt. */
function resumedBreakResponse(result: CloseResumeWorkResult) {
	return {
		id: result.resume.workPeriodId,
		startTime: dateFromInstant(parseInstant(result.resume.start.at)),
	};
}

/** Refusals of a structural break with useful feedback; null for unexpected failures. */
function describeBreakFailure(error: unknown): string | null {
	if (isUnresolvedWorkPeriodReview(error)) {
		return `${error.message}. Add the break once it is resolved.`;
	}
	if (error instanceof LiveWorkOccupiedError) {
		return "The break overlaps other recorded work.";
	}
	if (error instanceof ClockingConflictError) return "You are not currently clocked in.";
	if (error instanceof ConflictError) return error.message;
	if (error instanceof WorkIntervalError) {
		return "Break duration must be shorter than your current session.";
	}
	if (error instanceof CompletedWorkCollisionError) return CLOCK_OUT_COLLISION_ERROR;
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		return CLOCK_OUT_APPEND_REVIEW_REQUIRED_ERROR;
	}
	if (
		error instanceof ValidationError &&
		error.field === "managerId" &&
		error.message === "No manager assigned to approve time changes"
	) {
		return error.message;
	}
	return null;
}

/**
 * Web break on the active session (#304): closes the active work at
 * `now - breakMinutes` and resumes it now. Every organization runs it under the
 * clock-out owner and refuses it while the work has unresolved review.
 * Organizations whose append control is active run the shared close/resume
 * operation (#281): approval participation, append progression, canonical
 * record, carried attribution and one receipt. The others keep their
 * established writes.
 */
export async function addBreakToActiveSession(
	breakMinutes: number,
	actionContext: AddBreakActionContext = {},
): Promise<ServerActionResult<{ id: string; startTime: Date }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	if (!Number.isInteger(breakMinutes) || breakMinutes < 1) {
		return {
			success: false,
			error: "Enter a break duration of at least 1 minute.",
		};
	}
	let operationId: string;
	try {
		operationId =
			actionContext.submissionId === undefined
				? crypto.randomUUID()
				: requireCanonicalSubmissionId(actionContext.submissionId);
	} catch {
		return { success: false, error: ADD_BREAK_FAILED_ERROR };
	}
	const actorUserId = session.user.id;
	const command: AddBreakCommand = {
		version: 1,
		operationId,
		breakMinutes,
		browserTimezone: actionContext.browserTimezone ?? null,
		deviceInfo: "web",
	};
	const writer = liveClockOutWriter("web");
	const replayInput = {
		organizationId: currentEmployee.organizationId,
		employeeId: currentEmployee.id,
		command,
		writer: writer.writer,
	};

	// Receipts replay in every mode, before fresh preflight reads that the
	// committed break itself has changed.
	try {
		const replayed = await withWebClockOutTransaction(
			{
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				userId: actorUserId,
				submissionId: operationId,
			},
			createOrdinaryApprovalRuntime,
			(coordination) => replayCloseResumeWork(coordination, replayInput),
		);
		if (replayed) {
			return { success: true, data: resumedBreakResponse(replayed.result) };
		}
	} catch (error) {
		const failure = describeBreakFailure(error);
		if (failure) return { success: false, error: failure };
		logger.error({ error }, "Add break replay error");
		return { success: false, error: ADD_BREAK_FAILED_ERROR };
	}

	const activeWorkPeriod = await getActiveWorkPeriod(currentEmployee.id);
	if (!activeWorkPeriod) {
		return { success: false, error: "You are not currently clocked in." };
	}

	if (activeWorkPeriod.organizationId !== currentEmployee.organizationId) {
		return {
			success: false,
			error: "You are not allowed to edit this time entry",
		};
	}

	const timezone = await getUserTimezone(actorUserId);

	const nowInstant = systemClock.nowInstant();
	const breakStartInstant = nowInstant.subtract({ minutes: breakMinutes });
	const now = dateFromInstant(nowInstant);
	const breakStart = dateFromInstant(breakStartInstant);
	if (breakStart <= activeWorkPeriod.startTime) {
		return {
			success: false,
			error: "Break duration must be shorter than your current session.",
		};
	}

	let needsClockOutApproval = false;
	try {
		needsClockOutApproval = await checkClockOutNeedsApproval(currentEmployee.id);
	} catch (error) {
		logger.warn({ error }, "Failed to check clock-out approval requirement");
		return { success: false, error: APPROVAL_POLICY_CHECK_ERROR };
	}

	// Each endpoint is captured in the zone at its own instant.
	const capture = (timestamp: Date) =>
		resolveTimeEntryTimezoneCapture({
			timestamp,
			browserTimezone: actionContext.browserTimezone,
			fallbackTimezone: timezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
	const breakStartTimezoneCapture = capture(breakStart);
	const nowTimezoneCapture = capture(now);

	try {
		const result = await withWebClockOutTransaction(
			{
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				userId: actorUserId,
				submissionId: operationId,
				workPeriodId: activeWorkPeriod.id,
				endTime: breakStartInstant,
				requiresApproval: needsClockOutApproval,
			},
			createOrdinaryApprovalRuntime,
			async (coordination) => {
				const receipt = await replayCloseResumeWork(coordination, replayInput);
				if (receipt) return { kind: "replayed" as const, receipt };
				if (coordination.admission === "append") {
					return {
						kind: "operation" as const,
						executed: await closeAndResumeWork(coordination, {
							organizationId: currentEmployee.organizationId,
							employeeId: currentEmployee.id,
							teamId: currentEmployee.teamId,
							actorUserId,
							workPeriodId: activeWorkPeriod.id,
							command,
							writer,
							close: { instant: breakStartInstant, capture: breakStartTimezoneCapture },
							resume: { instant: nowInstant, capture: nowTimezoneCapture },
						}),
					};
				}
				return {
					kind: "legacy" as const,
					resumed: await addLegacyBreak(coordination, {
						organizationId: currentEmployee.organizationId,
						employeeId: currentEmployee.id,
						actorUserId,
						activeWorkPeriod,
						breakStart,
						now,
						breakStartTimezoneCapture,
						nowTimezoneCapture,
					}),
				};
			},
		);

		if (result.kind === "replayed") {
			return { success: true, data: resumedBreakResponse(result.receipt.result) };
		}
		if (result.kind === "legacy") {
			await markWorkBalanceDirtyAfterClockOutBestEffort(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					dirtyFromDate: instantFromDate(activeWorkPeriod.startTime)
						.toZonedDateTimeISO("UTC")
						.toPlainDate()
						.toString(),
				},
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					workPeriodId: activeWorkPeriod.id,
				},
			);
			return { success: true, data: result.resumed };
		}

		// The closure committed: follow-ups are the clock-out's, and none of them
		// can turn the committed break into a failure.
		const { closed } = result.executed;
		try {
			await completeClockOutAfterCommit({
				outcome: {
					entry: closed.entry,
					disposition: closed.disposition,
					durationMinutes: closed.result.segment.durationMinutes,
					approvalSubmission: closed.approvalSubmission ?? undefined,
					workPeriodId: closed.result.workPeriodId,
					startTime: dateFromInstant(parseInstant(closed.result.segment.startAt)),
					endTime: dateFromInstant(parseInstant(closed.result.segment.endAt)),
					surchargeSnapshot: closed.surchargeSnapshot,
					balanceRefreshCommitted: true,
				},
				employee: currentEmployee,
				userId: actorUserId,
				needsClockOutApproval,
				timezone,
				projectId: closed.result.attribution.projectId,
			});
		} catch (error) {
			logger.error({ error }, "Add break post-commit error");
		}
		return { success: true, data: resumedBreakResponse(result.executed.result) };
	} catch (error) {
		const failure = describeBreakFailure(error);
		if (failure) return { success: false, error: failure };
		logger.error({ error }, "Add break to active session error");
		return { success: false, error: ADD_BREAK_FAILED_ERROR };
	}
}

/**
 * The established break writes of organizations that have not adopted, inside
 * the clock-out owner and behind the unresolved-review guard.
 */
async function addLegacyBreak(
	coordination: WorkTransactionContext,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		activeWorkPeriod: { id: string; startTime: Date; workLocationType: WorkLocationType | null };
		breakStart: Date;
		now: Date;
		breakStartTimezoneCapture: ReturnType<typeof resolveTimeEntryTimezoneCapture>;
		nowTimezoneCapture: ReturnType<typeof resolveTimeEntryTimezoneCapture>;
	},
): Promise<{ id: string; startTime: Date }> {
	const { organizationId, employeeId, activeWorkPeriod } = input;
	coordination.assertEmployee(organizationId, employeeId);
	const tx = coordination.db;
	const [target] = await tx
		.select({ id: workPeriod.id, approvalStatus: workPeriod.approvalStatus })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, activeWorkPeriod.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, true),
			),
		)
		.limit(1);
	if (!target) throw new ClockingConflictError("Active work period changed");
	await assertNoUnresolvedWorkPeriodReview(tx, organizationId, target);

	const clockOutEntry = await createTimeEntry(
		{
			employeeId,
			organizationId,
			type: "clock_out",
			timestamp: input.breakStart,
			createdBy: input.actorUserId,
			...input.breakStartTimezoneCapture,
		},
		tx,
	);

	const durationMinutes = calculateDurationMinutes(
		activeWorkPeriod.startTime,
		input.breakStart,
	);

	const [closedWorkPeriod] = await tx
		.update(workPeriod)
		.set({
			clockOutId: clockOutEntry.id,
			endTime: input.breakStart,
			durationMinutes,
			isActive: false,
			approvalStatus: "approved",
			pendingChanges: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, activeWorkPeriod.id),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.isActive, true),
			),
		)
		.returning({ id: workPeriod.id });

	if (!closedWorkPeriod) {
		throw new Error("Active work period was not updated");
	}

	const clockInEntry = await createTimeEntry(
		{
			employeeId,
			organizationId,
			type: "clock_in",
			timestamp: input.now,
			createdBy: input.actorUserId,
			...input.nowTimezoneCapture,
		},
		tx,
	);

	const [insertedWorkPeriod] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: clockInEntry.id,
			startTime: input.now,
			workLocationType: activeWorkPeriod.workLocationType ?? "office",
		})
		.returning({ id: workPeriod.id, startTime: workPeriod.startTime });

	if (!insertedWorkPeriod) {
		throw new Error("New work period was not inserted");
	}

	return insertedWorkPeriod;
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
