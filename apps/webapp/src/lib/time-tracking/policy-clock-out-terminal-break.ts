/**
 * Policy clock-out terminal break (#256 §7, #303 / T39; #1221).
 *
 * A final policy clock-out approval that owes a required break divides the
 * approved work inside the approval transaction. This module states the
 * finalizer's policy only; work records (ADR 0010) divides the work period and
 * its canonical work record by the owed break, in either admission, and applies
 * the effects of the change (period submissions sent back, invoiced work
 * carried, the work balance marked dirty) inside the transaction.
 *
 * - It runs on the Approvals finalizer's database handle: under the owner's
 *   coordinated work transaction, or, in a legacy organization outside the
 *   coordinators, under the established employee locks it takes here before
 *   work records accepts the handle. An adopted organization without a work
 *   transaction is refused.
 * - The regulation comes from the policy snapshot captured with the clock-out;
 *   breaks already taken are counted as "approved work of the local day".
 * - Only the resolving lifecycle's own transition is exempt from the
 *   unresolved-review guard. The generated half inherits the approval state and
 *   is approved through the originating decision; no second human approval is
 *   recorded for it.
 * - Adopted organizations commit a `split_policy_clock_out_break` receipt with
 *   the segments and the decision lineage.
 * - Any outcome other than a division or "not required" is a
 *   `PolicyClockOutTerminalBreakError`; a closed month carries its
 *   `MonthClosedError` as the cause.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { completedWorkOperation, employee, userSettings } from "@/db/schema";
import type { OrdinaryWorkPeriodFinalizerDbService } from "@/lib/approvals/domain-adapters/work-period-contract";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { BreakPolicyRegulation } from "./break-policy-calculation";
import type { PolicyClockOutBreakSnapshot } from "./policy-clock-out-break-snapshot";
import { isValidIanaTimezone } from "./timezone-capture";
import { assertNoUnrelatedWorkPeriodReview } from "./work-period-review";
import {
	applyWorkRecordChange,
	type OwedBreakDivision,
	readWorkRecord,
	refusalError,
	type WorkRecordRefusal,
	type WorkSegment,
	workRecordScopeForFinalizer,
} from "./work-records";
import { holdFinalizerEmployeeLocks, type WorkTransactionClient } from "./work-transaction";

/** The approved work as the finalizer verified it; work that differs is stale. */
export interface PolicyClockOutTerminalPeriodSnapshot {
	id: string;
	clockInId: string;
	clockOutId: string;
	startTime: Date;
	endTime: Date;
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
	breakPolicySnapshot: PolicyClockOutBreakSnapshot;
}

export type PolicyClockOutTerminalBreakResult =
	| { kind: "not_required" }
	| {
			kind: "adjusted";
			breakMinutes: number;
			/** The period created after the inserted break. */
			secondPeriodId: string;
	  };

/** Why the terminal break was not applied; nothing was written. */
export type PolicyClockOutTerminalBreakRefusal =
	| WorkRecordRefusal
	/** The work is not the approved work of the lifecycle being finalized. */
	| { kind: "decision_mismatch" }
	/** The work was already auto-adjusted. */
	| { kind: "already_adjusted" }
	/** Neither the clock-out nor the employee names a zone for the break entries. */
	| { kind: "zone_unresolved" }
	/** The policy snapshot names a regulation without its identity. */
	| { kind: "regulation_incomplete" }
	/** This lifecycle's terminal split was already committed. */
	| { kind: "receipt_exists" };

export class PolicyClockOutTerminalBreakError extends Error {
	constructor(
		readonly refusal: PolicyClockOutTerminalBreakRefusal,
		options?: { cause?: unknown },
	) {
		super(`Policy clock-out terminal break refused: ${refusal.kind}`, options);
		this.name = "PolicyClockOutTerminalBreakError";
	}
}

function refuse(refusal: PolicyClockOutTerminalBreakRefusal): never {
	throw new PolicyClockOutTerminalBreakError(refusal);
}

export const POLICY_CLOCK_OUT_BREAK_OPERATION_COMMAND_VERSION = 1;
export const POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION = 1;
export const POLICY_CLOCK_OUT_BREAK_WRITER_VERSION = 1;

const OPERATION_NAMESPACE = "z8:policy-clock-out-break:v1";
const BREAK_NOTE = "Auto-adjusted: break enforcement";
const BREAK_SOURCE = { ipAddress: "system", deviceInfo: "break-enforcement" } as const;

/** One segment by value: committed evidence, not a pointer to current rows. */
export type PolicyClockOutBreakSegment = WorkSegment;

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
 * finally approved at most once, so a second fresh split is refused and rolls
 * the approval back.
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

/** The regulation the captured policy snapshot names, or null when none applies. */
function regulationFrom(snapshot: PolicyClockOutBreakSnapshot): BreakPolicyRegulation | null {
	if (
		snapshot.resolution === "none" ||
		!snapshot.regulationEnabled ||
		snapshot.breakRules.length === 0
	) {
		return null;
	}
	const { id, name, maxUninterruptedMinutes } = snapshot.regulation;
	if (id === null || name === null) return refuse({ kind: "regulation_incomplete" });
	return {
		id,
		name,
		maxUninterruptedMinutes,
		breakRules: snapshot.breakRules.map((rule) => ({
			workingMinutesThreshold: rule.workingMinutesThreshold,
			requiredBreakMinutes: rule.requiredBreakMinutes,
		})),
	};
}

/** The break entries' zone: the clock-out's, else the employee's own setting. */
async function breakEntriesZone(
	db: WorkTransactionClient,
	input: EnforcePolicyClockOutTerminalBreakInput,
	clockOutZone: string | null,
): Promise<string> {
	if (isValidIanaTimezone(clockOutZone)) return clockOutZone;
	const [settings] = await db
		.select({ timezone: userSettings.timezone })
		.from(employee)
		.innerJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	return isValidIanaTimezone(settings?.timezone)
		? settings.timezone
		: refuse({ kind: "zone_unresolved" });
}

export async function applyPolicyClockOutTerminalBreakInTransaction(
	input: EnforcePolicyClockOutTerminalBreakInput,
): Promise<PolicyClockOutTerminalBreakResult> {
	const { organizationId, employeeId } = input;
	const db = input.dbService.db as WorkTransactionClient;
	// The decision or submission coordinator already holds the owner's #264 protocol
	// for this transaction. Another approval runtime outside the coordinators (for
	// example an assignment activation after a reassignment) keeps the established
	// employee locks; work records accepts that only in a legacy organization.
	await holdFinalizerEmployeeLocks(db, { organizationId, employeeId });
	const scope = await workRecordScopeForFinalizer(db, { organizationId, employeeId });
	const adopted = scope.admission === "append";
	const regulation = regulationFrom(input.breakPolicySnapshot);

	const current = await readWorkRecord(
		scope,
		{ organizationId, employeeId, workPeriodId: input.period.id },
		{ lock: true },
	);
	if (!current) return refuse({ kind: "not_found", workPeriodId: input.period.id });
	const { period, clockOut, canonical } = current;
	const boundWorkflowId =
		input.lifecycle.authority === "canonical"
			? input.lifecycle.workflowId
			: input.lifecycle.observedWorkflowId;
	if (
		boundWorkflowId !== period.approvalWorkflowId ||
		period.approvalStatus !== "approved" ||
		(canonical && canonical.record.approvalState !== "approved")
	) {
		return refuse({ kind: "decision_mismatch" });
	}
	if (period.wasAutoAdjusted) return refuse({ kind: "already_adjusted" });
	if (!clockOut) return refuse({ kind: "endpoint_entry_missing" });

	const operationId = derivePolicyClockOutBreakOperationId(input);
	if (adopted) {
		const [receipt] = await db
			.select({ id: completedWorkOperation.id })
			.from(completedWorkOperation)
			.where(
				and(
					eq(completedWorkOperation.id, operationId),
					eq(completedWorkOperation.organizationId, organizationId),
				),
			)
			.limit(1);
		if (receipt) return refuse({ kind: "receipt_exists" });
	}

	const outcome = await applyWorkRecordChange(scope, {
		kind: "divide_owed_break",
		organizationId,
		employeeId,
		// The work exactly as the finalizer verified and approved it.
		expected: {
			workPeriodId: period.id,
			revision: current.expected.revision,
			clockInId: input.period.clockInId,
			clockOutId: input.period.clockOutId,
			startAt: instantFromDate(input.period.startTime),
			endAt: instantFromDate(input.period.endTime),
		},
		regulation,
		takenBefore: "approved_work_of_local_day",
		notes: BREAK_NOTE,
		actorUserId: input.actorUserId,
		entries: {
			createdBy: input.actorUserId,
			...BREAK_SOURCE,
			timezone: await breakEntriesZone(db, input, clockOut.timezone),
			timezoneSource: "historical_inference",
		},
		appendOperation: "policy_clock_out_break",
	});
	if (outcome.kind === "not_required") return { kind: "not_required" };
	if (outcome.kind !== "owed_break_divided") {
		throw new PolicyClockOutTerminalBreakError(outcome, { cause: refusalError(outcome) });
	}

	// The split is a structural change: only this lifecycle's own transition is
	// exempt from the unresolved-review guard (#256 §7). It applies only when a break
	// was owed, so it runs on the division; its refusal rolls the approval back.
	await assertNoUnrelatedWorkPeriodReview(db, organizationId, {
		workPeriodId: period.id,
		employeeId,
		workflowType: "policy_clock_out",
		workflowId: input.lifecycle.authority === "canonical" ? input.lifecycle.workflowId : null,
		approvalRequestId:
			input.lifecycle.authority === "legacy" ? input.lifecycle.approvalRequestId : null,
	});

	if (adopted) {
		await db.insert(completedWorkOperation).values({
			id: operationId,
			organizationId,
			employeeId,
			kind: "split_policy_clock_out_break",
			writer: "policy_clock_out_decision",
			writerVersion: POLICY_CLOCK_OUT_BREAK_WRITER_VERSION,
			commandVersion: POLICY_CLOCK_OUT_BREAK_OPERATION_COMMAND_VERSION,
			command: {
				version: POLICY_CLOCK_OUT_BREAK_OPERATION_COMMAND_VERSION,
				workPeriodId: period.id,
				lifecycle: input.lifecycle,
				sourceRevision: period.graphRevision,
			},
			appendAdmission: "append",
			actorKind: "system",
			actorUserId: null,
			workPeriodId: period.id,
			resultVersion: POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION,
			result: splitResult(input, operationId, outcome) as unknown as Record<string, unknown>,
		});
	}
	return {
		kind: "adjusted",
		breakMinutes: outcome.owedBreak.breakMinutes,
		secondPeriodId: outcome.generated.segment.workPeriodId,
	};
}

/** The split's receipt, built from work records' division. */
function splitResult(
	input: EnforcePolicyClockOutTerminalBreakInput,
	operationId: string,
	division: OwedBreakDivision,
): PolicyClockOutBreakSplitResult {
	const { owedBreak, source, retained, generated, appended, effects } = division;
	const linked = (evidence: OwedBreakDivision["appended"]["clockOut"]) => {
		const { entryId, previousEntryId, previousHash } = evidence;
		if (!previousEntryId || !previousHash) {
			throw new Error("An appended break entry has no predecessor");
		}
		return { entryId, previousEntryId, previousHash };
	};
	return {
		version: POLICY_CLOCK_OUT_BREAK_OPERATION_RESULT_VERSION,
		operationId,
		owner: { employeeId: input.employeeId },
		actors: {
			executing: { kind: "system", process: "policy_clock_out_break" },
			triggeredBy: { kind: "human", userId: input.actorUserId, employeeId: input.actorEmployeeId },
		},
		originatingWork: source.segment,
		decision: {
			lifecycle: input.lifecycle,
			recordDecisionId: input.decisionRecordId,
			action: "approved",
		},
		adjustment: {
			regulationId: owedBreak.regulation.id,
			regulationName: owedBreak.regulation.name,
			breakMinutes: owedBreak.breakMinutes,
			breakStartAt: instantToCanonicalString(owedBreak.startAt),
			breakEndAt: instantToCanonicalString(owedBreak.endAt),
		},
		segments: [
			{ role: "retained", ...retained.segment },
			{
				role: "generated",
				...generated.segment,
				origin: {
					workPeriodId: source.segment.workPeriodId,
					canonicalRecordId: source.segment.canonicalRecordId,
				},
				approval: { state: "approved", basis: "originating_decision" },
			},
		],
		append: { clockOut: linked(appended.clockOut), clockIn: linked(appended.clockIn) },
		revisions: {
			originating: { source: source.revision, result: retained.after.revision },
			generated: { source: null, result: generated.after.revision },
		},
		followUps: {
			workBalanceDirtyFromDate: effects.workBalanceDirtyFromDate,
			surchargePeriodIds: [source.segment.workPeriodId, generated.segment.workPeriodId],
		},
	};
}
