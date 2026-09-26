/**
 * Policy clock-out terminal break split (#256 §7, #303 / T39).
 *
 * A final policy clock-out approval that owes a required break splits the
 * approved period inside the approval transaction. It runs under the owner's
 * coordinated work transaction (the decision or submission coordinator took the
 * #264 protocol before any row lock); it never locks the employee late.
 *
 * Only the resolving lifecycle's own transition is exempt from the
 * unresolved-review guard. The split commits the retained and generated
 * entries, periods, canonical records, work details and allocations together
 * or not at all. In an organization whose append control is active it
 * additionally appends the generated entries through the append collaborator,
 * rounds each segment on its own from its exact UTC endpoints, advances the
 * source work revision and writes a `split_policy_clock_out_break` receipt with
 * the complete segment and decision lineage. The generated segment is approved
 * by the originating decision; no second human approval is recorded for it.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { completedWorkOperation } from "@/db/schema";
import {
	decodeApprovalDatabaseTimestamptz,
	decodeApprovalDatabaseTimestampWithoutTimeZone,
} from "@/lib/approvals/approval-database-row";
import type {
	OrdinaryWorkPeriodFinalizerDbService,
	WorkPeriodMaintenanceFacts,
} from "@/lib/approvals/domain-adapters/work-period-contract";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { calculateHash } from "./blockchain";
import { calculateBreakDeficit } from "./break-policy-calculation";
import type { PolicyClockOutBreakSnapshot } from "./policy-clock-out-break-snapshot";
import type { PolicyClockOutSurchargeSnapshot } from "./policy-clock-out-surcharge-snapshot";
import {
	admitTimeEntryAppend,
	type TimeEntryAppend,
	TimeEntryAppendReviewRequiredError,
} from "./time-entry-append";
import {
	isValidIanaTimezone,
	resolveFallbackTimezoneCapture,
} from "./timezone-capture";
import { deriveWorkDurationMinutes } from "./work-duration";
import { assertNoUnrelatedWorkPeriodReview } from "./work-period-review";
import { workTransactionScopeFor } from "./work-transaction";

type WorkLocationType = "office" | "home" | "remote" | "other" | null;

export interface PolicyClockOutTerminalPeriodSnapshot {
	id: string;
	organizationId: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string;
	canonicalRecordId: string;
	approvalWorkflowId: string | null;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	projectId: string | null;
	workCategoryId: string | null;
	workLocationType: WorkLocationType;
}

/** The approval lifecycle whose final approval this split resolves. */
export type PolicyClockOutTerminalLifecycle =
	| { authority: "canonical"; workflowId: string }
	| {
			authority: "legacy";
			approvalRequestId: string;
			/** The shadow workflow the legacy lifecycle is observed through, never its authority. */
			observedWorkflowId: string | null;
	  };

export interface EnforcePolicyClockOutTerminalBreakInput {
	dbService: OrdinaryWorkPeriodFinalizerDbService;
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	/** The deciding human; the trigger of the split, not its executing actor. */
	actorEmployeeId: string;
	lifecycle: PolicyClockOutTerminalLifecycle;
	/** The decision recorded on the originating canonical record. */
	decisionRecordId: string;
	period: PolicyClockOutTerminalPeriodSnapshot;
	adjustedAt: Instant;
	breakPolicySnapshot: PolicyClockOutBreakSnapshot;
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot;
}

export type PolicyClockOutTerminalBreakResult =
	| { kind: "not_required"; maintenance: WorkPeriodMaintenanceFacts }
	| {
			kind: "adjusted";
			breakMinutes: number;
			/** The period created after the inserted break. */
			secondPeriodId: string;
			maintenance: WorkPeriodMaintenanceFacts;
	  };

export const POLICY_CLOCK_OUT_BREAK_OPERATION_COMMAND_VERSION = 1;
export const POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION = 1;
export const POLICY_CLOCK_OUT_BREAK_WRITER_VERSION = 1;

const OPERATION_NAMESPACE = "z8:policy-clock-out-break:v1";

type AllocationEvidence = {
	allocationKind: "project" | "cost_center";
	projectId: string | null;
	costCenterId: string | null;
	weightPercent: number;
};

/** One segment by value: committed evidence, not a pointer to current rows. */
export type PolicyClockOutBreakSegment = {
	workPeriodId: string;
	canonicalRecordId: string;
	clockInEntryId: string;
	clockOutEntryId: string;
	startAt: string;
	endAt: string;
	durationMinutes: number;
	startUtcOffsetMinutes: number;
	endUtcOffsetMinutes: number;
	attribution: {
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: WorkLocationType;
		allocations: AllocationEvidence[];
	};
};

export type PolicyClockOutBreakSplitResult = {
	version: typeof POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actors: {
		executing: { kind: "system"; process: "policy_clock_out_break" };
		triggeredBy: { kind: "human"; userId: string; employeeId: string };
	};
	/** The approved period exactly as the split locked it. */
	originatingWork: PolicyClockOutBreakSegment;
	/** The decision the generated segment's approval derives from. */
	decision: {
		lifecycle: PolicyClockOutTerminalLifecycle;
		recordDecisionId: string;
		action: "approved";
	};
	adjustment: {
		regulationId: string;
		regulationName: string;
		breakMinutes: number;
		breakStartAt: string;
		breakEndAt: string;
	};
	segments: [
		PolicyClockOutBreakSegment & { role: "retained" },
		PolicyClockOutBreakSegment & {
			role: "generated";
			origin: { workPeriodId: string; canonicalRecordId: string };
			approval: { state: "approved"; basis: "originating_decision" };
		},
	];
	append: {
		clockOut: { entryId: string; previousEntryId: string; previousHash: string };
		clockIn: { entryId: string; previousEntryId: string; previousHash: string };
	};
	revisions: {
		originating: { source: number; result: number };
		generated: { source: null; result: number };
	};
	followUps: { workBalanceDirtyFromDate: string; surchargePeriodIds: string[] };
};

function uuidFromDigest(value: string): string {
	const bytes = new Uint8Array(createHash("sha1").update(value).digest().subarray(0, 16));
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stable receipt identity of one lifecycle's terminal split. A lifecycle is
 * finally approved at most once, so a second fresh split is a primary-key
 * collision that rolls the approval back.
 */
export function derivePolicyClockOutBreakOperationId(input: {
	organizationId: string;
	lifecycle: PolicyClockOutTerminalLifecycle;
}): string {
	const key =
		input.lifecycle.authority === "canonical"
			? `canonical:${input.lifecycle.workflowId}`
			: `legacy:${input.lifecycle.approvalRequestId}`;
	return uuidFromDigest(`${OPERATION_NAMESPACE}\0${input.organizationId}\0${key}`);
}

interface LockedSource extends PolicyClockOutTerminalPeriodSnapshot {
	approvalStatus: string;
	pendingChanges: unknown;
	isActive: boolean;
	deletedAt: Date | null;
	wasAutoAdjusted: boolean;
	originalEndTime: Date | null;
	originalDurationMinutes: number | null;
	clockInType: string;
	clockInTimestamp: Date;
	clockInTimezone: string | null;
	clockInUtcOffsetMinutes: number;
	clockOutType: string;
	clockOutTimestamp: Date;
	clockOutTimezone: string | null;
	clockOutUtcOffsetMinutes: number;
	graphRevision: number;
	employeeTimezone: string | null;
	canonicalId: string;
	canonicalStartAt: Date;
	canonicalEndAt: Date;
	canonicalDurationMinutes: number;
	canonicalApprovalState: string;
	canonicalOrigin: string;
	canonicalWorkCategoryId: string | null;
	canonicalWorkLocationType: WorkLocationType;
	computationMetadata: string | null;
	allocations: unknown[];
}

function fail(): never {
	throw new Error("Policy clock-out terminal break enforcement conflict");
}

function rows(result: unknown): unknown[] {
	if (
		typeof result !== "object" ||
		result === null ||
		!("rows" in result) ||
		!Array.isArray(result.rows)
	) {
		return fail();
	}
	return result.rows;
}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail();
	}
	return value as Record<string, unknown>;
}

function sameDate(left: unknown, right: Date): boolean {
	return left instanceof Date && left.getTime() === right.getTime();
}

function exactWrite(rowsValue: unknown[], expectedId: string): void {
	if (rowsValue.length !== 1 || object(rowsValue[0]).id !== expectedId) {
		fail();
	}
}

function validateAllocation(value: unknown): {
	allocationKind: "project" | "cost_center";
	projectId: string | null;
	costCenterId: string | null;
	weightPercent: number;
} {
	const allocation = object(value);
	if (
		(allocation.allocationKind !== "project" &&
			allocation.allocationKind !== "cost_center") ||
		(allocation.projectId !== null &&
			typeof allocation.projectId !== "string") ||
		(allocation.costCenterId !== null &&
			typeof allocation.costCenterId !== "string") ||
		!Number.isSafeInteger(allocation.weightPercent) ||
		(allocation.weightPercent as number) <= 0 ||
		(allocation.allocationKind === "project" &&
			(typeof allocation.projectId !== "string" ||
				allocation.costCenterId !== null)) ||
		(allocation.allocationKind === "cost_center" &&
			(typeof allocation.costCenterId !== "string" ||
				allocation.projectId !== null))
	) {
		return fail();
	}
	return allocation as ReturnType<typeof validateAllocation>;
}

function validateLockedSource(
	value: unknown,
	input: EnforcePolicyClockOutTerminalBreakInput,
): LockedSource {
	const source = object(value) as unknown as LockedSource;
	const period = input.period;
	if (
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.employeeId ||
		source.id !== period.id ||
		source.organizationId !== input.organizationId ||
		source.employeeId !== input.employeeId ||
		source.clockInId !== period.clockInId ||
		source.clockOutId !== period.clockOutId ||
		source.canonicalRecordId !== period.canonicalRecordId ||
		source.approvalWorkflowId !== period.approvalWorkflowId ||
		source.approvalStatus !== "approved" ||
		source.pendingChanges !== null ||
		source.isActive !== false ||
		source.deletedAt !== null ||
		source.wasAutoAdjusted !== false ||
		source.originalEndTime !== null ||
		source.originalDurationMinutes !== null ||
		!sameDate(source.startTime, period.startTime) ||
		!sameDate(source.endTime, period.endTime) ||
		source.durationMinutes !== period.durationMinutes ||
		source.projectId !== period.projectId ||
		source.workCategoryId !== period.workCategoryId ||
		source.workLocationType !== period.workLocationType ||
		source.clockInType !== "clock_in" ||
		source.clockOutType !== "clock_out" ||
		!sameDate(source.clockInTimestamp, period.startTime) ||
		!Number.isInteger(source.clockInUtcOffsetMinutes) ||
		!Number.isInteger(source.clockOutUtcOffsetMinutes) ||
		!Number.isSafeInteger(source.graphRevision) ||
		source.graphRevision < 0 ||
		!sameDate(source.clockOutTimestamp, period.endTime) ||
		source.canonicalId !== period.canonicalRecordId ||
		!sameDate(source.canonicalStartAt, period.startTime) ||
		!sameDate(source.canonicalEndAt, period.endTime) ||
		source.canonicalDurationMinutes !== period.durationMinutes ||
		source.canonicalApprovalState !== "approved" ||
		source.canonicalOrigin !== "clock" ||
		source.canonicalWorkCategoryId !== period.workCategoryId ||
		source.canonicalWorkLocationType !== period.workLocationType ||
		!Array.isArray(source.allocations)
	) {
		return fail();
	}
	return source;
}

/** The established employee locks of a legacy split outside the coordinators. */
async function lockEmployeeUncoordinated(
	input: EnforcePolicyClockOutTerminalBreakInput,
): Promise<void> {
	const db = input.dbService.db;
	const employeeLock = await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${input.employeeId}, 0)) as locked`,
	);
	if (rows(employeeLock).length !== 1) fail();
	const ownershipLockKey = JSON.stringify([input.organizationId, input.employeeId]);
	const ownershipLock = await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${ownershipLockKey}, 0)) as locked`,
	);
	if (rows(ownershipLock).length !== 1) fail();
}

export async function applyPolicyClockOutTerminalBreakInTransaction(
	input: EnforcePolicyClockOutTerminalBreakInput,
): Promise<PolicyClockOutTerminalBreakResult> {
	const db = input.dbService.db;
	// The decision or submission coordinator already holds the owner's #264
	// protocol for this transaction, so the split takes no lock of its own.
	const scope = workTransactionScopeFor(db);
	if (scope) {
		if (scope.db !== db) return fail();
		scope.assertEmployee(input.organizationId, input.employeeId);
	} else {
		// Another approval runtime reached this terminal outside the coordinators
		// (for example an assignment activation after a reassignment). As for #301
		// corrections, an adopted organization is refused; a legacy organization
		// keeps the established employee locks.
		const control = await db.execute(sql`
			select mode from time_entry_append_control
			where organization_id = ${input.organizationId}
		`);
		if (rows(control).some((row) => object(row).mode === "active")) return fail();
		await lockEmployeeUncoordinated(input);
	}
	const adopted = scope?.admission === "append";
	const boundWorkflowId =
		input.lifecycle.authority === "canonical"
			? input.lifecycle.workflowId
			: input.lifecycle.observedWorkflowId;
	if (boundWorkflowId !== input.period.approvalWorkflowId) return fail();

	const sourceResult = await db.execute(sql`
		select
			period.id,
			period.organization_id as "organizationId",
			period.employee_id as "employeeId",
			period.clock_in_id as "clockInId",
			period.clock_out_id as "clockOutId",
			period.canonical_record_id as "canonicalRecordId",
			period.approval_workflow_id as "approvalWorkflowId",
			period.approval_status as "approvalStatus",
			period.pending_changes as "pendingChanges",
			period.is_active as "isActive",
			period.deleted_at as "deletedAt",
			period.was_auto_adjusted as "wasAutoAdjusted",
			period.original_end_time as "originalEndTime",
			period.original_duration_minutes as "originalDurationMinutes",
			period.start_time as "startTime",
			period.end_time as "endTime",
			period.duration_minutes as "durationMinutes",
			period.project_id as "projectId",
			period.work_category_id as "workCategoryId",
			period.work_location_type as "workLocationType",
			clock_in.type as "clockInType",
			clock_in.timestamp as "clockInTimestamp",
			clock_in.timezone as "clockInTimezone",
			clock_in.utc_offset_minutes as "clockInUtcOffsetMinutes",
			clock_out.type as "clockOutType",
			clock_out.timestamp as "clockOutTimestamp",
			clock_out.timezone as "clockOutTimezone",
			clock_out.utc_offset_minutes as "clockOutUtcOffsetMinutes",
			period.graph_revision as "graphRevision",
			settings.timezone as "employeeTimezone",
			canonical.id as "canonicalId",
			canonical.start_at as "canonicalStartAt",
			canonical.end_at as "canonicalEndAt",
			canonical.duration_minutes as "canonicalDurationMinutes",
			canonical.approval_state as "canonicalApprovalState",
			canonical.origin as "canonicalOrigin",
			canonical_work.work_category_id as "canonicalWorkCategoryId",
			canonical_work.work_location_type as "canonicalWorkLocationType",
			canonical_work.computation_metadata as "computationMetadata",
			coalesce((
				select json_agg(json_build_object(
					'allocationKind', allocation.allocation_kind,
					'projectId', allocation.project_id,
					'costCenterId', allocation.cost_center_id,
					'weightPercent', allocation.weight_percent
				) order by allocation.id)
				from time_record_allocation allocation
				where allocation.organization_id = period.organization_id
					and allocation.record_id = canonical.id
			), '[]'::json) as allocations
		from work_period period
		join employee employee_row
			on employee_row.id = period.employee_id
			and employee_row.organization_id = period.organization_id
		join time_entry clock_in
			on clock_in.id = period.clock_in_id
			and clock_in.organization_id = period.organization_id
			and clock_in.employee_id = period.employee_id
		join time_entry clock_out
			on clock_out.id = period.clock_out_id
			and clock_out.organization_id = period.organization_id
			and clock_out.employee_id = period.employee_id
		join time_record canonical
			on canonical.id = period.canonical_record_id
			and canonical.organization_id = period.organization_id
			and canonical.employee_id = period.employee_id
			and canonical.record_kind = 'work'
		join time_record_work canonical_work
			on canonical_work.record_id = canonical.id
			and canonical_work.organization_id = canonical.organization_id
		left join user_settings settings on settings.user_id = employee_row.user_id
		where period.id = ${input.period.id}::uuid
			and period.organization_id = ${input.organizationId}
			and period.employee_id = ${input.employeeId}::uuid
		limit 2
		for update of period, clock_in, clock_out, canonical, canonical_work
	`);
	const sourceRows = rows(sourceResult);
	if (sourceRows.length !== 1) return fail();
	const rawSource = object(sourceRows[0]);
	const source = validateLockedSource(
		{
			...rawSource,
			startTime: decodeApprovalDatabaseTimestampWithoutTimeZone(
				rawSource.startTime,
			),
			endTime: decodeApprovalDatabaseTimestampWithoutTimeZone(
				rawSource.endTime,
			),
			deletedAt:
				rawSource.deletedAt === null
					? null
					: decodeApprovalDatabaseTimestampWithoutTimeZone(rawSource.deletedAt),
			originalEndTime:
				rawSource.originalEndTime === null
					? null
					: decodeApprovalDatabaseTimestamptz(rawSource.originalEndTime),
			clockInTimestamp: decodeApprovalDatabaseTimestampWithoutTimeZone(
				rawSource.clockInTimestamp,
			),
			clockOutTimestamp: decodeApprovalDatabaseTimestampWithoutTimeZone(
				rawSource.clockOutTimestamp,
			),
			canonicalStartAt: decodeApprovalDatabaseTimestampWithoutTimeZone(
				rawSource.canonicalStartAt,
			),
			canonicalEndAt: decodeApprovalDatabaseTimestampWithoutTimeZone(
				rawSource.canonicalEndAt,
			),
		},
		input,
	);
	const dirtyTimezone = offsetMinutesToTimeZoneId(
		source.clockInUtcOffsetMinutes,
	);
	const timezone = isValidIanaTimezone(source.clockOutTimezone)
		? source.clockOutTimezone
		: isValidIanaTimezone(source.employeeTimezone)
			? source.employeeTimezone
			: fail();
	const maintenance = (
		surchargePeriodIds: string[],
	): WorkPeriodMaintenanceFacts => ({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		dirtyFromDate: instantFromDate(source.startTime)
			.toZonedDateTimeISO(dirtyTimezone)
			.toPlainDate()
			.toString(),
		decision: "approved",
		surchargePeriodIds,
		staleSurchargePeriodIds: [],
		surchargeSnapshot: input.surchargeSnapshot,
	});

	if (input.breakPolicySnapshot.resolution === "none") {
		return { kind: "not_required", maintenance: maintenance([source.id]) };
	}
	if (
		!input.breakPolicySnapshot.regulationEnabled ||
		input.breakPolicySnapshot.breakRules.length === 0
	) {
		return { kind: "not_required", maintenance: maintenance([source.id]) };
	}
	if (
		input.breakPolicySnapshot.regulation.id === null ||
		input.breakPolicySnapshot.regulation.name === null
	) {
		return fail();
	}
	const breakRules = input.breakPolicySnapshot.breakRules.map((rule) => ({
		workingMinutesThreshold: rule.workingMinutesThreshold,
		requiredBreakMinutes: rule.requiredBreakMinutes,
	}));
	const calculation = calculateBreakDeficit({
		sessionDurationMinutes: source.durationMinutes,
		alreadyTakenBreakMinutes: 0,
		regulation: {
			id: input.breakPolicySnapshot.regulation.id,
			name: input.breakPolicySnapshot.regulation.name,
			maxUninterruptedMinutes:
				input.breakPolicySnapshot.regulation.maxUninterruptedMinutes,
			breakRules,
		},
	});
	if (calculation.deficit === 0 || !calculation.applicableRule) {
		return { kind: "not_required", maintenance: maintenance([source.id]) };
	}

	const sourceStart = instantFromDate(source.startTime);
	const sourceEnd = instantFromDate(source.endTime);
	const localDayStart = sourceEnd.toZonedDateTimeISO(timezone).startOfDay();
	const localDayEnd = localDayStart.add({ days: 1 });
	const gapResult = await db.execute(sql`
		select start_time as "gapStart", end_time as "gapEnd"
		from work_period
		where organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
			and approval_status = 'approved'
			and is_active = false
			and deleted_at is null
			and end_time is not null
			and start_time >= ${dateFromInstant(localDayStart.toInstant())}
			and start_time < ${dateFromInstant(localDayEnd.toInstant())}
			and start_time <= ${source.endTime}
		order by start_time, id
		for update
	`);
	let alreadyTakenBreakMinutes = 0;
	let previousEnd: Instant | null = null;
	for (const value of rows(gapResult)) {
		const period = object(value);
		const gapStart = instantFromDate(
			decodeApprovalDatabaseTimestampWithoutTimeZone(period.gapStart),
		);
		const gapEnd = instantFromDate(
			decodeApprovalDatabaseTimestampWithoutTimeZone(period.gapEnd),
		);
		if (compareInstants(gapEnd, gapStart) < 0) return fail();
		if (compareInstants(gapStart, sourceEnd) > 0) break;
		const boundedGapEnd =
			compareInstants(gapEnd, sourceEnd) > 0 ? sourceEnd : gapEnd;
		if (previousEnd && compareInstants(gapStart, previousEnd) > 0) {
			const gapMinutes = Math.floor(
				gapStart.since(previousEnd).total({ unit: "minutes" }),
			);
			if (gapMinutes > 1) alreadyTakenBreakMinutes += gapMinutes;
		}
		if (!previousEnd || compareInstants(boundedGapEnd, previousEnd) > 0) {
			previousEnd = boundedGapEnd;
		}
	}

	const finalCalculation = calculateBreakDeficit({
		sessionDurationMinutes: source.durationMinutes,
		alreadyTakenBreakMinutes,
		regulation: {
			id: calculation.regulationId ?? fail(),
			name: calculation.regulationName ?? fail(),
			maxUninterruptedMinutes: calculation.maxUninterruptedMinutes,
			breakRules,
		},
	});
	if (finalCalculation.deficit === 0 || !finalCalculation.applicableRule) {
		return { kind: "not_required", maintenance: maintenance([source.id]) };
	}

	const insertAfterMinutes =
		finalCalculation.maxUninterruptedMinutes !== null
			? Math.min(
					finalCalculation.maxUninterruptedMinutes,
					finalCalculation.applicableRule.workingMinutesThreshold,
				)
			: finalCalculation.applicableRule.workingMinutesThreshold;
	if (!Number.isSafeInteger(insertAfterMinutes) || insertAfterMinutes <= 0) {
		return fail();
	}
	const breakStart = sourceStart.add({ minutes: insertAfterMinutes });
	const breakEnd = breakStart.add({ minutes: finalCalculation.deficit });
	if (
		compareInstants(breakStart, sourceStart) <= 0 ||
		compareInstants(breakStart, sourceEnd) >= 0 ||
		compareInstants(breakEnd, sourceStart) <= 0 ||
		compareInstants(breakEnd, sourceEnd) >= 0
	) {
		return fail();
	}
	// Adopted: each segment rounds its own exact UTC elapsed time (#252 §2). Legacy
	// organizations keep the established arithmetic on the stored minutes.
	const firstDurationMinutes = adopted
		? deriveWorkDurationMinutes(sourceStart, breakStart)
		: insertAfterMinutes;
	const secondDurationMinutes = adopted
		? deriveWorkDurationMinutes(breakEnd, sourceEnd)
		: source.durationMinutes - finalCalculation.deficit - insertAfterMinutes;
	const adjustedTotal = firstDurationMinutes + secondDurationMinutes;
	// A positive segment that rounds to zero minutes is valid work (#252); the
	// endpoint checks above already rejected empty or reversed segments.
	const minimumSegmentMinutes = adopted ? 0 : 1;
	if (
		!Number.isSafeInteger(adjustedTotal) ||
		!Number.isSafeInteger(firstDurationMinutes) ||
		!Number.isSafeInteger(secondDurationMinutes) ||
		adjustedTotal < minimumSegmentMinutes ||
		firstDurationMinutes < minimumSegmentMinutes ||
		secondDurationMinutes < minimumSegmentMinutes
	) {
		return fail();
	}

	// The split is a structural change: only this lifecycle's own transition is
	// exempt from the unresolved-review guard (#256 §7).
	await assertNoUnrelatedWorkPeriodReview(db, input.organizationId, {
		workPeriodId: source.id,
		employeeId: input.employeeId,
		workflowType: "policy_clock_out",
		workflowId: input.lifecycle.authority === "canonical" ? input.lifecycle.workflowId : null,
		approvalRequestId:
			input.lifecycle.authority === "legacy" ? input.lifecycle.approvalRequestId : null,
	});

	let append: TimeEntryAppend | null = null;
	let latest: { latestId: string; latestHash: string };
	if (adopted) {
		// Adopted: the exact predecessor comes from append evidence, never from the
		// latest-created row.
		const admission = await admitTimeEntryAppend(
			scope.db,
			{ organizationId: input.organizationId, employeeId: input.employeeId },
			"policy_clock_out_break",
		);
		if (admission.kind === "review_required") {
			throw new TimeEntryAppendReviewRequiredError(admission.requirement);
		}
		append = admission.append;
		const predecessor = append.predecessor ?? fail();
		latest = { latestId: predecessor.id, latestHash: predecessor.hash };
	} else {
		const chainResult = await db.execute(sql`
			select id as "latestId", hash as "latestHash"
			from time_entry
			where organization_id = ${input.organizationId}
				and employee_id = ${input.employeeId}::uuid
			order by created_at desc, id desc
			limit 2
			for update
		`);
		const chainRows = rows(chainResult);
		if (chainRows.length < 1 || chainRows.length > 2) return fail();
		const head = object(chainRows[0]);
		if (typeof head.latestId !== "string" || typeof head.latestHash !== "string") {
			return fail();
		}
		latest = { latestId: head.latestId, latestHash: head.latestHash };
	}

	const breakStartDate = dateFromInstant(breakStart);
	const breakEndDate = dateFromInstant(breakEnd);
	const breakStartCapture = resolveFallbackTimezoneCapture({
		timestamp: breakStartDate,
		timezone,
		timezoneSource: "historical_inference",
	});
	const breakEndCapture = resolveFallbackTimezoneCapture({
		timestamp: breakEndDate,
		timezone,
		timezoneSource: "historical_inference",
	});
	const syntheticClockOutId = randomUUID();
	const syntheticClockInId = randomUUID();
	const secondRecordId = randomUUID();
	const secondPeriodId = randomUUID();
	const syntheticClockOutHash = calculateHash({
		employeeId: input.employeeId,
		type: "clock_out",
		timestamp: breakStartDate.toISOString(),
		previousHash: latest.latestHash,
	});
	const syntheticClockInHash = calculateHash({
		employeeId: input.employeeId,
		type: "clock_in",
		timestamp: breakEndDate.toISOString(),
		previousHash: syntheticClockOutHash,
	});
	const adjustedAt = dateFromInstant(input.adjustedAt);
	const secondEntryCreatedAt = dateFromInstant(
		input.adjustedAt.add({ milliseconds: 1 }),
	);
	const note = "Auto-adjusted: break enforcement";
	const adjustmentReason = JSON.stringify({
		type: "break_enforcement",
		regulationId: finalCalculation.regulationId,
		regulationName: finalCalculation.regulationName,
		breakInsertedMinutes: finalCalculation.deficit,
		breakInsertedAt: breakStart.toString(),
		originalDurationMinutes: source.durationMinutes,
		adjustedDurationMinutes: adjustedTotal,
		ruleApplied: finalCalculation.applicableRule,
	});

	const insertedClockOut = await db.execute(sql`
		insert into time_entry (
			id, organization_id, employee_id, type, timestamp,
			utc_offset_minutes, timezone, timezone_source,
			previous_entry_id, hash, previous_hash, notes,
			ip_address, device_info, created_at, created_by
		) values (
			${syntheticClockOutId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			${"clock_out"}, ${breakStartDate}, ${breakStartCapture.utcOffsetMinutes},
			${breakStartCapture.timezone}, ${breakStartCapture.timezoneSource},
			${latest.latestId}::uuid, ${syntheticClockOutHash}, ${latest.latestHash}, ${note},
			${"system"}, ${"break-enforcement"}, ${adjustedAt}, ${input.actorUserId}
		)
		returning id
	`);
	exactWrite(rows(insertedClockOut), syntheticClockOutId);
	await append?.record({
		id: syntheticClockOutId,
		hash: syntheticClockOutHash,
		previousEntryId: latest.latestId,
		previousHash: latest.latestHash,
	});
	const insertedClockIn = await db.execute(sql`
		insert into time_entry (
			id, organization_id, employee_id, type, timestamp,
			utc_offset_minutes, timezone, timezone_source,
			previous_entry_id, hash, previous_hash, notes,
			ip_address, device_info, created_at, created_by
		) values (
			${syntheticClockInId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			${"clock_in"}, ${breakEndDate}, ${breakEndCapture.utcOffsetMinutes},
			${breakEndCapture.timezone}, ${breakEndCapture.timezoneSource},
			${syntheticClockOutId}::uuid, ${syntheticClockInHash}, ${syntheticClockOutHash}, ${note},
			${"system"}, ${"break-enforcement"}, ${secondEntryCreatedAt}, ${input.actorUserId}
		)
		returning id
	`);
	exactWrite(rows(insertedClockIn), syntheticClockInId);
	await append?.record({
		id: syntheticClockInId,
		hash: syntheticClockInHash,
		previousEntryId: syntheticClockOutId,
		previousHash: syntheticClockOutHash,
	});

	const workflowPredicate = source.approvalWorkflowId
		? sql`approval_workflow_id = ${source.approvalWorkflowId}::uuid`
		: sql`approval_workflow_id is null`;
	const updatedPeriod = await db.execute(sql`
		update work_period set
			clock_out_id = ${syntheticClockOutId}::uuid,
			end_time = ${breakStartDate},
			duration_minutes = ${firstDurationMinutes},
			was_auto_adjusted = true,
			auto_adjustment_reason = ${adjustmentReason},
			auto_adjusted_at = ${adjustedAt},
			original_end_time = ${source.endTime},
			original_duration_minutes = ${source.durationMinutes},
			graph_revision = ${adopted ? source.graphRevision + 1 : source.graphRevision},
			updated_at = ${adjustedAt}
		where id = ${source.id}::uuid
			and organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
			and clock_in_id = ${source.clockInId}::uuid
			and clock_out_id = ${source.clockOutId}::uuid
			and canonical_record_id = ${source.canonicalRecordId}::uuid
			and ${workflowPredicate}
			and start_time = ${source.startTime}
			and end_time = ${source.endTime}
			and duration_minutes = ${source.durationMinutes}
			and approval_status = 'approved'
			and pending_changes is null
			and is_active = false
			and deleted_at is null
			and was_auto_adjusted = false
			and original_end_time is null
			and original_duration_minutes is null
			and graph_revision = ${source.graphRevision}
		returning id
	`);
	exactWrite(rows(updatedPeriod), source.id);

	const updatedRecord = await db.execute(sql`
		update time_record set
			end_at = ${breakStartDate},
			duration_minutes = ${firstDurationMinutes},
			updated_at = ${adjustedAt},
			updated_by = ${input.actorUserId}
		where id = ${source.canonicalRecordId}::uuid
			and organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
			and record_kind = 'work'
			and origin = 'clock'
			and start_at = ${source.startTime}
			and end_at = ${source.endTime}
			and duration_minutes = ${source.durationMinutes}
			and approval_state = 'approved'
		returning id
	`);
	exactWrite(rows(updatedRecord), source.canonicalRecordId);

	const insertedRecord = await db.execute(sql`
		insert into time_record (
			id, organization_id, employee_id, record_kind, start_at, end_at,
			duration_minutes, approval_state, origin, created_at, created_by,
			updated_at, updated_by
		) values (
			${secondRecordId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			'work', ${breakEndDate}, ${source.endTime}, ${secondDurationMinutes},
			'approved', 'clock', ${adjustedAt}, ${input.actorUserId},
			${adjustedAt}, ${input.actorUserId}
		)
		returning id
	`);
	exactWrite(rows(insertedRecord), secondRecordId);
	const insertedWork = await db.execute(sql`
		insert into time_record_work (
			record_id, organization_id, record_kind, work_category_id,
			work_location_type, computation_metadata
		) values (
			${secondRecordId}::uuid, ${input.organizationId}, 'work',
			${source.canonicalWorkCategoryId}::uuid, ${source.canonicalWorkLocationType},
			${source.computationMetadata}
		)
		returning record_id as id
	`);
	exactWrite(rows(insertedWork), secondRecordId);

	for (const allocationValue of source.allocations) {
		const allocation = validateAllocation(allocationValue);
		const allocationId = randomUUID();
		const insertedAllocation = await db.execute(sql`
			insert into time_record_allocation (
				id, organization_id, record_id, allocation_kind,
				project_id, cost_center_id, weight_percent, created_at
			) values (
				${allocationId}::uuid, ${input.organizationId}, ${secondRecordId}::uuid,
				${allocation.allocationKind}, ${allocation.projectId}::uuid,
				${allocation.costCenterId}::uuid, ${allocation.weightPercent}, ${adjustedAt}
			)
			returning id
		`);
		exactWrite(rows(insertedAllocation), allocationId);
	}

	const insertedPeriod = await db.execute(sql`
		insert into work_period (
			id, organization_id, employee_id, clock_in_id, clock_out_id,
			project_id, work_category_id, work_location_type,
			start_time, end_time, duration_minutes, is_active,
			approval_status, pending_changes, was_auto_adjusted,
			auto_adjustment_reason, auto_adjusted_at,
			original_end_time, original_duration_minutes,
			canonical_record_id, approval_workflow_id, graph_revision, created_at, updated_at
		) values (
			${secondPeriodId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			${syntheticClockInId}::uuid, ${source.clockOutId}::uuid,
			${source.projectId}::uuid, ${source.workCategoryId}::uuid,
			${source.workLocationType}, ${breakEndDate}, ${source.endTime},
			${secondDurationMinutes}, false, 'approved', ${null}, true,
			${adjustmentReason}, ${adjustedAt}, ${null}, ${null},
			${secondRecordId}::uuid, ${null}, ${adopted ? 1 : 0}, ${adjustedAt}, ${adjustedAt}
		)
		returning id
	`);
	exactWrite(rows(insertedPeriod), secondPeriodId);

	const followUps = maintenance([source.id, secondPeriodId]);
	if (adopted) {
		const allocations = source.allocations.map(validateAllocation);
		const attribution = {
			projectId: source.projectId,
			workCategoryId: source.workCategoryId,
			workLocationType: source.workLocationType,
			allocations,
		};
		const segment = (values: {
			workPeriodId: string;
			canonicalRecordId: string;
			clockInEntryId: string;
			clockOutEntryId: string;
			start: Instant;
			end: Instant;
			durationMinutes: number;
			startUtcOffsetMinutes: number;
			endUtcOffsetMinutes: number;
		}): PolicyClockOutBreakSegment => ({
			workPeriodId: values.workPeriodId,
			canonicalRecordId: values.canonicalRecordId,
			clockInEntryId: values.clockInEntryId,
			clockOutEntryId: values.clockOutEntryId,
			startAt: instantToCanonicalString(values.start),
			endAt: instantToCanonicalString(values.end),
			durationMinutes: values.durationMinutes,
			startUtcOffsetMinutes: values.startUtcOffsetMinutes,
			endUtcOffsetMinutes: values.endUtcOffsetMinutes,
			attribution,
		});
		const operationId = derivePolicyClockOutBreakOperationId({
			organizationId: input.organizationId,
			lifecycle: input.lifecycle,
		});
		const result: PolicyClockOutBreakSplitResult = {
			version: POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION,
			operationId,
			owner: { employeeId: input.employeeId },
			actors: {
				executing: { kind: "system", process: "policy_clock_out_break" },
				triggeredBy: {
					kind: "human",
					userId: input.actorUserId,
					employeeId: input.actorEmployeeId,
				},
			},
			originatingWork: segment({
				workPeriodId: source.id,
				canonicalRecordId: source.canonicalRecordId,
				clockInEntryId: source.clockInId,
				clockOutEntryId: source.clockOutId,
				start: sourceStart,
				end: sourceEnd,
				durationMinutes: source.durationMinutes,
				startUtcOffsetMinutes: source.clockInUtcOffsetMinutes,
				endUtcOffsetMinutes: source.clockOutUtcOffsetMinutes,
			}),
			decision: {
				lifecycle: input.lifecycle,
				recordDecisionId: input.decisionRecordId,
				action: "approved",
			},
			adjustment: {
				regulationId: finalCalculation.regulationId ?? fail(),
				regulationName: finalCalculation.regulationName ?? fail(),
				breakMinutes: finalCalculation.deficit,
				breakStartAt: instantToCanonicalString(breakStart),
				breakEndAt: instantToCanonicalString(breakEnd),
			},
			segments: [
				{
					role: "retained",
					...segment({
						workPeriodId: source.id,
						canonicalRecordId: source.canonicalRecordId,
						clockInEntryId: source.clockInId,
						clockOutEntryId: syntheticClockOutId,
						start: sourceStart,
						end: breakStart,
						durationMinutes: firstDurationMinutes,
						startUtcOffsetMinutes: source.clockInUtcOffsetMinutes,
						endUtcOffsetMinutes: breakStartCapture.utcOffsetMinutes,
					}),
				},
				{
					role: "generated",
					...segment({
						workPeriodId: secondPeriodId,
						canonicalRecordId: secondRecordId,
						clockInEntryId: syntheticClockInId,
						clockOutEntryId: source.clockOutId,
						start: breakEnd,
						end: sourceEnd,
						durationMinutes: secondDurationMinutes,
						startUtcOffsetMinutes: breakEndCapture.utcOffsetMinutes,
						endUtcOffsetMinutes: source.clockOutUtcOffsetMinutes,
					}),
					origin: {
						workPeriodId: source.id,
						canonicalRecordId: source.canonicalRecordId,
					},
					approval: { state: "approved", basis: "originating_decision" },
				},
			],
			append: {
				clockOut: {
					entryId: syntheticClockOutId,
					previousEntryId: latest.latestId,
					previousHash: latest.latestHash,
				},
				clockIn: {
					entryId: syntheticClockInId,
					previousEntryId: syntheticClockOutId,
					previousHash: syntheticClockOutHash,
				},
			},
			revisions: {
				originating: { source: source.graphRevision, result: source.graphRevision + 1 },
				generated: { source: null, result: 1 },
			},
			followUps: {
				workBalanceDirtyFromDate: followUps.dirtyFromDate,
				surchargePeriodIds: followUps.surchargePeriodIds,
			},
		};
		const [existing] = await scope.db
			.select({ id: completedWorkOperation.id })
			.from(completedWorkOperation)
			.where(eq(completedWorkOperation.id, operationId))
			.limit(1);
		if (existing) return fail();
		await scope.db.insert(completedWorkOperation).values({
			id: operationId,
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			kind: "split_policy_clock_out_break",
			writer: "policy_clock_out_decision",
			writerVersion: POLICY_CLOCK_OUT_BREAK_WRITER_VERSION,
			commandVersion: POLICY_CLOCK_OUT_BREAK_OPERATION_COMMAND_VERSION,
			command: {
				version: POLICY_CLOCK_OUT_BREAK_OPERATION_COMMAND_VERSION,
				workPeriodId: source.id,
				lifecycle: input.lifecycle,
				sourceRevision: source.graphRevision,
			},
			appendAdmission: "append",
			actorKind: "system",
			actorUserId: null,
			workPeriodId: source.id,
			resultVersion: POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION,
			result: result as unknown as Record<string, unknown>,
		});
	}

	return {
		kind: "adjusted",
		breakMinutes: finalCalculation.deficit,
		secondPeriodId,
		maintenance: followUps,
	};
}

export const enforcePolicyClockOutTerminalBreakInTransaction =
	applyPolicyClockOutTerminalBreakInTransaction;
