import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime, IANAZone } from "luxon";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	approvalRequest,
	employee,
	employeeManagers,
	type timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workCategory,
	workPeriod,
} from "@/db/schema";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "@/lib/approvals/server/work-period-approvals";
import {
	executeOrdinaryWorkPeriodSubmissionInTransaction,
	type WorkPeriodPostCommitDescriptor,
} from "@/lib/approvals/server/work-period-submission";
import { deriveApprovalWorkflowId } from "@/lib/approvals/workflow/identity";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import {
	asAppSubject,
	defineAbilityFor,
	type PrincipalContext,
} from "@/lib/authorization";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import {
	dateFromInstant,
	type Instant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { employeeHasAccessToCategory } from "@/lib/query/work-category.queries";
import {
	ClockingConflictError,
	clockingService,
} from "@/lib/time-tracking/clocking-service";
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
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { canonicalWorkRecordClient } from "../actions.canonical";
import {
	sendClockOutApprovalNotifications,
	sendClockOutApprovedNotification,
	sendManualEntryApprovalNotifications,
	sendManualEntryApprovedNotification,
} from "./approvals";
import { getCurrentEmployee, getCurrentSession, getUserTimezone } from "./auth";
import {
	calculateAndPersistSurcharges,
	calculateBreaksTakenToday,
	checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut,
} from "./compliance";
import {
	checkProjectBudgetAfterClockOut,
	createTimeEntry,
	validateProjectAssignment,
} from "./entry-helpers";
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
const MANUAL_ENTRY_TARGET_AUTH_ERROR =
	"Not authorized to create time entries for this employee";
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
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
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
	const root = exactPlainObject(
		input.metadata,
		hasAutoApproval
			? ["timeRequest", "ordinarySubmission", "autoApproval"]
			: ["timeRequest", "ordinarySubmission"],
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
	tx: typeof db,
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
	tx: typeof db;
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

function createOrdinaryApprovalRuntime() {
	return createProductionApprovalWorkflowRuntime({
		db,
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
	deviceInfo?: "web" | "mobile";
};

async function resolveManualTimeEntryTarget(params: {
	currentEmployee: typeof employee.$inferSelect;
	requestedEmployeeId?: string;
	sessionUser: { id: string; role?: string | null };
}): Promise<
	| {
			success: true;
			targetEmployee: typeof employee.$inferSelect;
			isOwnEntry: boolean;
	  }
	| { success: false; error: string }
> {
	const { currentEmployee, requestedEmployeeId, sessionUser } = params;
	if (!requestedEmployeeId || requestedEmployeeId === currentEmployee.id) {
		return { success: true, targetEmployee: currentEmployee, isOwnEntry: true };
	}

	const requesterRole = currentEmployee.role;
	const canTargetOtherEmployees =
		requesterRole === "admin" ||
		requesterRole === "manager" ||
		sessionUser.role === "admin";
	if (!canTargetOtherEmployees) {
		return { success: false, error: MANUAL_ENTRY_TARGET_AUTH_ERROR };
	}

	const targetEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, requestedEmployeeId),
			eq(employee.organizationId, currentEmployee.organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!targetEmployee) {
		return { success: false, error: MANUAL_ENTRY_TARGET_AUTH_ERROR };
	}

	const managedRecords = await db.query.employeeManagers.findMany({
		where: and(
			eq(employeeManagers.managerId, currentEmployee.id),
			eq(employeeManagers.employeeId, targetEmployee.id),
		),
		columns: { employeeId: true },
	});
	const principal: PrincipalContext = {
		userId: sessionUser.id,
		isPlatformAdmin: sessionUser.role === "admin",
		activeOrganizationId: currentEmployee.organizationId,
		orgMembership: null,
		employee: {
			id: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			role: currentEmployee.role,
			teamId: currentEmployee.teamId,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: managedRecords.map((record) => record.employeeId),
		customRoles: [],
	};

	const ability = defineAbilityFor(principal);
	const canCreateForTarget = ability.can(
		"read",
		asAppSubject("Employee", {
			id: targetEmployee.id,
			employeeId: targetEmployee.id,
			organizationId: targetEmployee.organizationId,
			teamId: targetEmployee.teamId,
		}),
	);

	return canCreateForTarget
		? { success: true, targetEmployee, isOwnEntry: false }
		: { success: false, error: MANUAL_ENTRY_TARGET_AUTH_ERROR };
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

async function validateWorkCategoryAssignment(
	employeeId: string,
	workCategoryId: string,
	organizationId: string,
) {
	const category = await db.query.workCategory.findFirst({
		where: and(
			eq(workCategory.id, workCategoryId),
			eq(workCategory.organizationId, organizationId),
			eq(workCategory.isActive, true),
		),
	});
	if (!category) {
		return { isValid: false, error: "Work category not found" };
	}
	return (await employeeHasAccessToCategory(employeeId, workCategoryId))
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

	const [timezone, activeWorkPeriod] = await Promise.all([
		getUserTimezone(session.user.id),
		getActiveWorkPeriod(currentEmployee.id),
	]);
	if (activeWorkPeriod) {
		return { success: false, error: "You are already clocked in" };
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
		};
	}

	const resolvedWorkLocationType = workLocationType ?? "office";

	if (!isWorkLocationType(resolvedWorkLocationType)) {
		return { success: false, error: "Invalid work location type" };
	}

	const billingAccess = await requireBillingForMutation(
		currentEmployee.organizationId,
	);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
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
		const { entry } = await clockingService.clockIn({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			createdBy: session.user.id,
			action: { instant: actionInstant, ...timezoneCapture },
			source: {
				ipAddress: null,
				deviceInfo: actionContext.deviceInfo ?? "web",
			},
			workLocationType: resolvedWorkLocationType,
		});

		return {
			success: true,
			data: entry as Awaited<ReturnType<typeof createTimeEntry>>,
		};
	} catch (error) {
		if (error instanceof ClockingConflictError) {
			return { success: false, error: "You are already clocked in" };
		}
		logger.error({ error }, "Clock in error");
		return { success: false, error: "Failed to clock in. Please try again." };
	}
}

export async function clockOut(
	projectId: string | undefined,
	workCategoryId: string | undefined,
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
	let submissionId: string;
	try {
		submissionId = requireCanonicalSubmissionId(actionContext?.submissionId);
	} catch {
		return { success: false, error: "Failed to clock out. Please try again." };
	}

	try {
		const runtime = createOrdinaryApprovalRuntime();
		const replay = await runtime.repository.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as typeof db;
			const evidence = await findPolicyClockOutSubmissionEvidence({
				tx,
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
					organizationId: currentEmployee.organizationId,
					workPeriodId: period.id,
					submissionId,
					requesterEmployeeId: currentEmployee.id,
					requesterUserId: session.user.id,
					teamId: currentEmployee.teamId,
					defaultApproverId: null,
					reason: "Clock-out requires approval (0-day policy)",
					overtimeRisk: "warning",
					kind: "policy_clock_out",
					metadata: {},
				}),
			);
			return { period, approvalSubmission };
		});
		if (replay) {
			return {
				success: true,
				data: {
					...(replay.period.clockOut as ClockOutResult),
					pendingApproval: replay.approvalSubmission
						? replay.approvalSubmission.result.kind !== "auto_completed"
						: undefined,
				},
			};
		}
	} catch (error) {
		logger.error({ error }, "Clock out replay error");
		return { success: false, error: "Failed to clock out. Please try again." };
	}

	const [timezone, activeWorkPeriod] = await Promise.all([
		getUserTimezone(session.user.id),
		getActiveWorkPeriod(currentEmployee.id),
	]);
	if (!activeWorkPeriod) {
		return { success: false, error: "You are not currently clocked in" };
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
		};
	}

	let needsClockOutApproval = false;
	try {
		needsClockOutApproval = await checkClockOutNeedsApproval(
			currentEmployee.id,
		);
	} catch (error) {
		logger.warn({ error }, "Failed to check clock-out approval requirement");
		return { success: false, error: APPROVAL_POLICY_CHECK_ERROR };
	}
	if (needsClockOutApproval && !submissionId) {
		return { success: false, error: "Failed to clock out. Please try again." };
	}

	try {
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: now,
			browserTimezone: actionContext.browserTimezone,
			fallbackTimezone: timezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
		const sessionDurationMinutes = calculateDurationMinutes(
			activeWorkPeriod.startTime,
			now,
		);
		const pendingChanges = needsClockOutApproval
			? {
					originalStartTime: activeWorkPeriod.startTime.toISOString(),
					originalEndTime: now.toISOString(),
					originalDurationMinutes: sessionDurationMinutes,
					requestedAt: now.toISOString(),
					requestedBy: session.user.id,
					isNewClockOut: true,
					ordinarySubmission: {
						submissionId,
						kind: "policy_clock_out" as const,
					},
				}
			: null;
		const runtime = createOrdinaryApprovalRuntime();
		const result = await runtime.repository.withTransaction(async (context) => {
			const clockOutResult = await clockingService.clockOut({
				transaction: context.dbService.db,
				actionId: submissionId,
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				workPeriodId: activeWorkPeriod.id,
				createdBy: session.user.id,
				action: { instant: actionInstant, ...timezoneCapture },
				source: {
					ipAddress: null,
					deviceInfo: actionContext.deviceInfo ?? "web",
				},
				projectId,
				workCategoryId,
				approvalStatus: needsClockOutApproval ? "pending" : "approved",
				pendingChanges,
				beforePeriodClose: async ({ transaction }) => {
					const canonicalRecord =
						await canonicalWorkRecordClient.createForCompletedPeriod(
							{
								organizationId: currentEmployee.organizationId,
								employeeId: currentEmployee.id,
								startAt: activeWorkPeriod.startTime,
								endAt: now,
								durationMinutes: sessionDurationMinutes,
								approvalState: needsClockOutApproval ? "pending" : "approved",
								createdBy: session.user.id,
								workCategoryId: workCategoryId ?? null,
								workLocationType: activeWorkPeriod.workLocationType ?? null,
								projectId: projectId ?? null,
								origin: "clock",
							},
							transaction as Parameters<
								Parameters<typeof db.transaction>[0]
							>[0],
						);
					return { canonicalRecordId: canonicalRecord.id };
				},
				afterPeriodClose: needsClockOutApproval
					? async ({ transaction }) => {
							if (transaction !== context.dbService.db) {
								throw new Error("Clock-out transaction context changed");
							}
							return executeOrdinaryWorkPeriodSubmissionInTransaction({
								dbService: approvalDbServiceForTransaction(context.dbService),
								context,
								organizationId: currentEmployee.organizationId,
								workPeriodId: activeWorkPeriod.id,
								submissionId: requireCanonicalSubmissionId(submissionId),
								requesterEmployeeId: currentEmployee.id,
								requesterUserId: session.user.id,
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
				tx: context.dbService.db as unknown as typeof db,
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
					submissionId: requireCanonicalSubmissionId(submissionId),
					requesterEmployeeId: currentEmployee.id,
					requesterUserId: session.user.id,
					teamId: currentEmployee.teamId,
					defaultApproverId: null,
					reason: "Clock-out requires approval (0-day policy)",
					overtimeRisk: "warning",
					kind: "policy_clock_out",
					metadata: {},
				}),
			);
			return { ...clockOutResult, transactionResult };
		});
		const entry = result.entry as Awaited<ReturnType<typeof createTimeEntry>>;
		const { durationMinutes } = result;

		const approvalSubmission = result.transactionResult as
			| {
					result: { kind: string };
					disposition: "executed" | "replayed";
					postCommit: WorkPeriodPostCommitDescriptor | null;
			  }
			| undefined;
		const approvalResult = approvalSubmission?.result;
		const approvalAutoCompleted = approvalResult?.kind === "auto_completed";
		if (
			needsClockOutApproval &&
			approvalSubmission?.disposition === "executed" &&
			approvalSubmission?.postCommit?.disposition === "dispatch"
		) {
			const notificationManagerId =
				approvalSubmission.postCommit.approverEmployeeId;
			if (!notificationManagerId) {
				logger.warn(
					{ organizationId: currentEmployee.organizationId },
					"Clock-out approval has no notification recipient",
				);
			} else {
				const notificationParams = {
					workPeriodId: activeWorkPeriod.id,
					employeeId: currentEmployee.id,
					managerId: notificationManagerId,
					organizationId: currentEmployee.organizationId,
					startTime: activeWorkPeriod.startTime,
					endTime: now,
					durationMinutes,
					dedupeKey: approvalSubmission.postCommit.dedupeKey,
				};
				try {
					if (approvalSubmission.postCommit.event === "approved") {
						await sendClockOutApprovedNotification(notificationParams);
					} else {
						await sendClockOutApprovalNotifications(notificationParams);
					}
				} catch (error) {
					logger.error(
						{
							error,
							organizationId: currentEmployee.organizationId,
							workPeriodId: activeWorkPeriod.id,
						},
						"Failed to dispatch clock-out approval notification after commit",
					);
				}
			}
		}

		const shouldRunPostCommitEffects =
			result.disposition === "executed" &&
			(!needsClockOutApproval ||
				approvalSubmission?.disposition === "executed");
		if (shouldRunPostCommitEffects) {
			await bestEffort(
				() =>
					calculateAndPersistSurcharges(
						activeWorkPeriod.id,
						currentEmployee.organizationId,
					),
				"Failed to calculate surcharges after clock-out",
				{ workPeriodId: activeWorkPeriod.id },
			);
		}
		let complianceWarnings: Awaited<
			ReturnType<typeof checkComplianceAfterClockOut>
		> = [];
		if (shouldRunPostCommitEffects) {
			await bestEffort(
				async () => {
					complianceWarnings = await checkComplianceAfterClockOut(
						currentEmployee.id,
						currentEmployee.organizationId,
						activeWorkPeriod.id,
						durationMinutes,
						timezone,
					);
				},
				"Failed to check compliance after clock-out",
				{ workPeriodId: activeWorkPeriod.id },
			);
		}

		let breakEnforcementResult: Awaited<
			ReturnType<typeof enforceBreaksAfterClockOut>
		> = { wasAdjusted: false };
		// Task 8 terminal maintenance consumes policy clock-out break deferrals.
		if (
			shouldRunPostCommitEffects &&
			approvalSubmission?.postCommit?.deferBreakEnforcement !== true
		) {
			await bestEffort(
				async () => {
					breakEnforcementResult = await enforceBreaksAfterClockOut({
						employeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
						workPeriodId: activeWorkPeriod.id,
						sessionDurationMinutes: durationMinutes,
						timezone,
						createdBy: session.user.id,
					});
				},
				"Failed to enforce breaks after clock-out",
				{ workPeriodId: activeWorkPeriod.id },
			);
		}

		if (shouldRunPostCommitEffects) {
			await markWorkBalanceDirtyAfterClockOutBestEffort(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					dirtyFromDate:
						DateTime.fromJSDate(activeWorkPeriod.startTime, {
							zone: "utc",
						}).toISODate() ?? undefined,
				},
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					workPeriodId: activeWorkPeriod.id,
				},
			);
		}

		if (projectId && shouldRunPostCommitEffects) {
			void checkProjectBudgetAfterClockOut(
				projectId,
				currentEmployee.organizationId,
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
					organizationId: currentEmployee.organizationId,
					workPeriodId: activeWorkPeriod.id,
				},
			);
		}

		return {
			success: true,
			data: {
				...entry,
				pendingApproval: approvalSubmission
					? !approvalAutoCompleted
					: undefined,
				complianceWarnings:
					complianceWarnings.length > 0 ? complianceWarnings : undefined,
				breakAdjustment: breakEnforcementResult.wasAdjusted
					? breakEnforcementResult.adjustment
					: undefined,
			},
		};
	} catch (error) {
		if (error instanceof ClockingConflictError) {
			return { success: false, error: "You are not currently clocked in" };
		}
		if (
			error instanceof ValidationError &&
			Object.getPrototypeOf(error) !== ValidationError.prototype &&
			error.field === "managerId" &&
			error.message === "No manager assigned to approve time changes"
		) {
			return { success: false, error: error.message };
		}
		logger.error({ error }, "Clock out error");
		return { success: false, error: "Failed to clock out. Please try again." };
	}
}

export async function addBreakToActiveSession(
	breakMinutes: number,
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

	const timezone = await getUserTimezone(session.user.id);

	const now = new Date();
	const breakStart = new Date(now.getTime() - breakMinutes * ONE_MINUTE_MS);
	if (breakStart <= activeWorkPeriod.startTime) {
		return {
			success: false,
			error: "Break duration must be shorter than your current session.",
		};
	}

	try {
		const breakStartTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: breakStart,
			timezone,
			timezoneSource: "user_setting",
		});
		const nowTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: now,
			timezone,
			timezoneSource: "user_setting",
		});
		const newWorkPeriod = await db.transaction(async (tx) => {
			const clockOutEntry = await createTimeEntry(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					type: "clock_out",
					timestamp: breakStart,
					createdBy: session.user.id,
					...breakStartTimezoneCapture,
				},
				tx,
			);

			const durationMinutes = calculateDurationMinutes(
				activeWorkPeriod.startTime,
				breakStart,
			);

			const [closedWorkPeriod] = await tx
				.update(workPeriod)
				.set({
					clockOutId: clockOutEntry.id,
					endTime: breakStart,
					durationMinutes,
					isActive: false,
					approvalStatus: "approved",
					pendingChanges: null,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(workPeriod.id, activeWorkPeriod.id),
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						eq(workPeriod.isActive, true),
					),
				)
				.returning({ id: workPeriod.id });

			if (!closedWorkPeriod) {
				throw new Error("Active work period was not updated");
			}

			const clockInEntry = await createTimeEntry(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					type: "clock_in",
					timestamp: now,
					createdBy: session.user.id,
					...nowTimezoneCapture,
				},
				tx,
			);

			const [insertedWorkPeriod] = await tx
				.insert(workPeriod)
				.values({
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					clockInId: clockInEntry.id,
					startTime: now,
					workLocationType: activeWorkPeriod.workLocationType ?? "office",
				})
				.returning({ id: workPeriod.id, startTime: workPeriod.startTime });

			if (!insertedWorkPeriod) {
				throw new Error("New work period was not inserted");
			}

			return insertedWorkPeriod;
		});

		await markWorkBalanceDirtyAfterClockOutBestEffort(
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				dirtyFromDate:
					DateTime.fromJSDate(activeWorkPeriod.startTime, {
						zone: "utc",
					}).toISODate() ?? undefined,
			},
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				workPeriodId: activeWorkPeriod.id,
			},
		);

		return { success: true, data: newWorkPeriod };
	} catch (error) {
		logger.error({ error }, "Add break to active session error");
		return { success: false, error: "Failed to add break. Please try again." };
	}
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
	const targetResolution = await resolveManualTimeEntryTarget({
		currentEmployee,
		requestedEmployeeId: data.employeeId,
		sessionUser: {
			id: session.user.id,
			role: (session.user as { role?: string | null }).role,
		},
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

	const savedTimezone = isOwnEntry
		? await getUserTimezone(session.user.id)
		: await getUserTimezone(targetEmployee.userId ?? session.user.id);
	const timezone = isOwnEntry
		? (data.timezone ?? savedTimezone)
		: savedTimezone;
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
		let editCapability: Awaited<ReturnType<typeof getEditCapabilityForPeriod>>;
		try {
			editCapability = await getEditCapabilityForPeriod({
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

		if (editCapability.type === "forbidden") {
			return {
				success: false,
				error: `Entries older than ${editCapability.daysBack} days can only be created by admins or team leads.`,
			};
		}

		requiresApproval = editCapability.type === "approval_required";
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
		const runtime = createOrdinaryApprovalRuntime();
		const {
			period: createdWorkPeriod,
			approvalSubmission,
			disposition,
			requiresApproval: committedRequiresApproval,
			resultEvidence: committedResultEvidence,
		} = await runtime.repository.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as typeof db;
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
			const clockOutEntry = await createTimeEntry(
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
			);
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

			const [period] = await tx
				.insert(workPeriod)
				.values({
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
					isActive: false,
					approvalStatus: requiresApproval ? "pending" : "approved",
					pendingChanges: (requiresApproval
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
							}
						: null) as never,
				})
				.returning();

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
		requiresApproval = committedRequiresApproval;

		const approvalResult = approvalSubmission?.result;
		const postCommit = approvalSubmission?.postCommit;
		if (
			requiresApproval &&
			approvalSubmission?.disposition === "executed" &&
			postCommit?.disposition === "dispatch" &&
			postCommit.approverEmployeeId
		) {
			const notificationParams = {
				workPeriodId: createdWorkPeriod.id,
				employeeId: targetEmployee.id,
				managerId: postCommit.approverEmployeeId,
				organizationId: targetEmployee.organizationId,
				startTime: adjustedClockIn,
				endTime: adjustedClockOut,
				durationMinutes,
				reason: data.reason,
				dedupeKey: postCommit.dedupeKey,
			};
			try {
				if (postCommit.event === "approved") {
					await sendManualEntryApprovedNotification(notificationParams);
				} else {
					await sendManualEntryApprovalNotifications(notificationParams);
				}
			} catch (error) {
				logger.error(
					{
						error,
						organizationId: targetEmployee.organizationId,
						workPeriodId: createdWorkPeriod.id,
					},
					"Failed to dispatch manual-entry approval notification after commit",
				);
			}
		}

		const approvalAutoCompleted = approvalResult?.kind === "auto_completed";
		const shouldRunPostCommitEffects =
			disposition === "executed" &&
			(!requiresApproval || approvalSubmission?.disposition === "executed");
		if (
			shouldRunPostCommitEffects &&
			(!requiresApproval || approvalAutoCompleted)
		) {
			await bestEffort(
				() =>
					calculateAndPersistSurcharges(
						createdWorkPeriod.id,
						targetEmployee.organizationId,
					),
				"Failed to calculate surcharges after manual time entry",
				{ workPeriodId: createdWorkPeriod.id },
			);
		}

		if (shouldRunPostCommitEffects) {
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
