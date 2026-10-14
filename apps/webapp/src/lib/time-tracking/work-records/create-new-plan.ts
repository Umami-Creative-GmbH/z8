/**
 * Creating new completed work (ADR 0010, #1223): completed work that never was
 * live work, recorded at once with both endpoints. A manual entry, imported
 * work and demo data come into being this way; live work is completed by
 * `create { completing }` instead. Types and a pure plan step only: no I/O, no
 * server-only imports.
 */
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import type { WorkPeriodPendingChanges } from "@/db/schema/types";
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { TimeEntryTimezoneCapture } from "../timezone-capture";
import { vehicleUseColumns } from "../vehicle-use/work-vehicle-use";
import type { NewEntryProvenance, WorkRecordRefusal } from "./change";
import {
	type PlannedHalf,
	plannedHalf,
	type WorkDurationArithmetic,
	workDurationMinutes,
} from "./plan";
import { recordAgreement } from "./record-agreement";
import {
	UnrepresentableWorkAttributionError,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

/** One endpoint of new work: the entry appended for it, captured in the zone it was resolved in. */
export type NewWorkEndpoint = {
	at: Instant;
	notes: string | null;
	capture: TimeEntryTimezoneCapture;
};

/**
 * The approval state new work starts in. Pending work carries the approval
 * evidence its caller's submission reads (`pending_changes`); the caller starts
 * the approval itself, after the creation, in the same transaction.
 */
export type NewWorkApproval =
	| { state: "approved" }
	| { state: "pending"; pendingChanges: WorkPeriodPendingChanges };

/** Who created the canonical work record's work, as payroll reads it. */
export type NewWorkOrigin = "manual" | "import" | "clock";

/**
 * Create new completed work from its two endpoints: a clock-in and a clock-out
 * entry are appended, the closed work period and its canonical work record (with
 * detail and project allocation) are created in agreement, and the effects
 * follow. Callers keep their own policy (authority, eligibility, receipts and
 * replay, how they map a refusal) and resolve billability before: work records
 * reads no project here.
 */
export type CreateNewWork = {
	kind: "create_new";
	organizationId: string;
	employeeId: string;
	/** The new work period's id (an operation identity, e.g. a manual submission); generated when omitted. */
	workPeriodId?: string;
	start: NewWorkEndpoint;
	end: NewWorkEndpoint;
	/** The work's attribution, applied to none; omitted records none. */
	attribution?: WorkAttributionPatch;
	approval: NewWorkApproval;
	origin: NewWorkOrigin;
	/** Evidence kept on the canonical work detail (a legacy manual submission's replay evidence). */
	computationMetadata?: string | null;
	/** Recorded as the canonical work record's creator. */
	recordedBy: string;
	/** The user the effects name (send-back); null for a job or the system. */
	actorUserId: string | null;
	/** Who and what records the entries; each endpoint has its own capture. */
	entries: Omit<NewEntryProvenance, "capture">;
	/** The append position's record of the operation that appended the entries. */
	appendOperation: TimeEntryAppendOperation;
};

export type NewWorkPlan = { kind: "create_new"; completed: PlannedHalf };

const NO_ATTRIBUTION = WorkAttribution.fromWorkPeriod({
	projectId: null,
	taskId: null,
	isBillable: false,
	workCategoryId: null,
	workLocationType: null,
	...vehicleUseColumns(null),
});

/**
 * What the new work period and its canonical work record will hold: the
 * interval between the endpoints, its minutes rounded by the admission's
 * arithmetic, the approval state named, and the attribution. The planned pair
 * must agree.
 */
export function planNewWork(
	change: Pick<CreateNewWork, "start" | "end" | "attribution" | "approval">,
	arithmetic: WorkDurationArithmetic,
): NewWorkPlan | WorkRecordRefusal {
	const startAt = change.start.at;
	const endAt = change.end.at;
	if (compareInstants(endAt, startAt) <= 0) return { kind: "interval_invalid" };
	let attribution: WorkAttribution;
	try {
		attribution = NO_ATTRIBUTION.apply(change.attribution ?? {});
	} catch (error) {
		if (error instanceof UnrepresentableWorkAttributionError) {
			return { kind: "attribution_unrepresentable", reason: error.reason };
		}
		throw error;
	}
	const state = change.approval.state;
	const completed = plannedHalf(
		{ startAt, endAt, durationMinutes: workDurationMinutes(arithmetic, startAt, endAt) },
		attribution,
		[],
		{ period: state, record: state },
	);
	const agreement = recordAgreement(completed.period, completed.canonical);
	if (!agreement.agrees) {
		return {
			kind: "canonical_divergence",
			found: "planned_half",
			disagreements: agreement.disagreements,
		};
	}
	return { kind: "create_new", completed };
}
