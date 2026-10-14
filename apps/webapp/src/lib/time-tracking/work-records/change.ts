/**
 * The vocabulary of work records' interface (ADR 0010): the changes callers ask
 * for, the expected state each change names, and the outcomes that come back.
 * Types only, no I/O and no server-only imports.
 *
 * Callers state policy (where to divide, the notes, an odometer reading, an
 * attribution override); work records works out what each half carries. New
 * operations join `WorkRecordChange` and `WorkRecordRefusal` as their slices
 * land: create (#1222), create new (#1223), amend (#1225), delete (#1227), owed-break division
 * (#1220/#1221, with its `takenBefore`).
 */
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { AppendReviewRequirement } from "../time-entry-append";
import type { TimeEntryTimezoneCapture } from "../timezone-capture";
import type { WorkVehicleUseChangeRefusalCode } from "../vehicle-use/work-vehicle-use-refusals";
import type { WorkOccupant } from "../work-occupancy";
import type { AmendWorkRecord } from "./amend-change";
import type { CreateNewWork } from "./create-new-plan";
import type { CreateWorkRecord } from "./create-plan";
import type { DivideByOwedBreak } from "./owed-break";
import type { RecordAgreementFacet } from "./record-agreement";
import type { AttachWorkRecord, RepairWorkRecord } from "./repair-change";
import type {
	UnrepresentableWorkAttribution,
	WorkAttribution,
	WorkAttributionPatch,
} from "./work-attribution";

/**
 * The state of a completed work period a change was decided against. Every
 * change names one: the work period and its revision are required, the other
 * fields are optional and compared when given. A difference is a `stale`
 * outcome and nothing is written; every write is compare-and-set on the
 * revision, which work records advances.
 */
export type WorkRecordExpected = {
	readonly workPeriodId: string;
	readonly revision: number;
	readonly clockInId?: string;
	readonly clockOutId?: string;
	readonly startAt?: Instant;
	readonly endAt?: Instant;
	readonly attribution?: WorkAttribution;
};

/** Who and what records the time entries a change appends. */
export type NewEntryProvenance = {
	createdBy: string;
	ipAddress: string | null;
	deviceInfo: string | null;
	/** The capture of the instant the entries mark, in the zone it was resolved in. */
	capture: TimeEntryTimezoneCapture;
};

/** One half of a division: `retained` keeps the work period's id, `generated` is new. */
export type DivisionHalf = "retained" | "generated";

/** A change of one half's work attribution, on top of what the division carries. */
export type HalfAttributionOverride = {
	half: DivisionHalf;
	patch: WorkAttributionPatch;
};

/**
 * Divide completed work at an instant strictly inside it. The retained half
 * keeps the work period, its clock-in and its canonical work record; the
 * generated half gets a new work period and canonical work record and keeps the
 * source clock-out. Two entries are appended at the instant: a clock-out
 * ending the retained half and a clock-in starting the generated half.
 */
export type DivideWorkRecord = {
	kind: "divide";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	at: Instant;
	notes: {
		/** The new clock-out's notes. */
		before: string | null;
		/**
		 * The new clock-in's notes. When given, they also replace the source
		 * clock-out's notes, which the generated half keeps and shows.
		 */
		after: string | null;
	};
	/**
	 * The one value asked at the instant of work with vehicle use (#1126): the
	 * odometer reading, or the retained half's km of a directly entered distance.
	 */
	odometerKm?: number | null;
	/** An attribution change for one half, e.g. no vehicle across a break. */
	attribution?: HalfAttributionOverride;
	/** The user making the change; null for a job or the system. */
	actorUserId: string | null;
	entries: NewEntryProvenance;
	/** The append position's record of the operation that appended the entries. */
	appendOperation: TimeEntryAppendOperation;
};

export type WorkRecordChange =
	| DivideWorkRecord
	| DivideByOwedBreak
	| AmendWorkRecord
	| CreateWorkRecord
	| CreateNewWork
	| AttachWorkRecord
	| RepairWorkRecord;

/** Why a change was not made. Nothing is written for any of them. */
export type WorkRecordRefusal =
	| { kind: "not_found"; workPeriodId: string }
	| {
			kind: "stale";
			/** The current state, for a caller that wants to show what changed. */
			current: { revision: number };
	  }
	| { kind: "work_running" }
	/** A creation's live work is no longer live: completed, deleted or already ending. */
	| { kind: "work_not_live" }
	| { kind: "canonical_record_missing" }
	| {
			kind: "canonical_divergence";
			/**
			 * Whether the locked pair disagreed, or a planned half (or amended,
			 * attached or repaired pair) would have.
			 */
			found: "locked_pair" | "planned_half" | "planned_amendment" | "planned_repair";
			disagreements: RecordAgreementFacet[];
	  }
	| { kind: "endpoint_entry_missing" }
	| { kind: "endpoint_superseded" }
	| { kind: "instant_outside_work" }
	| { kind: "vehicle_use_refused"; code: WorkVehicleUseChangeRefusalCode }
	| { kind: "attribution_unrepresentable"; reason: UnrepresentableWorkAttribution }
	| { kind: "month_closed"; month: string }
	| { kind: "work_occupied"; occupants: WorkOccupant[] }
	| { kind: "append_review_required"; requirement: AppendReviewRequirement }
	/** Amend (#1225): the change names nothing that differs from the stored work. */
	| { kind: "unchanged" }
	/** Amend (#1225), create new (#1223): the times do not end after they start. */
	| { kind: "interval_invalid" }
	/**
	 * Amend (#1226): an adopted endpoint is not a pending correction of this
	 * employee replacing the current endpoint.
	 */
	| { kind: "adopted_entry_mismatch" }
	/** Attach (#1226): the work already has a canonical work record, linked or of its id. */
	| { kind: "canonical_record_present" };

export type WorkRecordRefusalKind = WorkRecordRefusal["kind"];
