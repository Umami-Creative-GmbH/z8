/**
 * Creating completed work from live work (ADR 0010, #1222): the change Clocking
 * hands over at every clock-out, and its plan. The single handover from
 * Clocking's live work to completed work: Clocking keeps the live work and the
 * clock command; work records closes the work period, appends the clock-out
 * entry and creates the canonical work record with its detail and allocation.
 * Types and a pure plan step only: no I/O, no server-only imports.
 */
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { deriveWorkDurationMinutes } from "../work-duration";
import type { NewEntryProvenance, WorkRecordExpected, WorkRecordRefusal } from "./change";
import { plannedPairsRefusal } from "./pair-agreement";
import { type PlannedHalf, plannedHalf } from "./plan";
import type { TimeEntryRow, WorkPeriodRow } from "./rows";
import {
	UnrepresentableWorkAttributionError,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

/** The live work a creation completes, as `readWorkRecord(..., { lock: true })` returns it. */
export type CompletingLiveWork = {
	period: WorkPeriodRow;
	clockIn: TimeEntryRow | null;
};

/**
 * Complete live work at an instant: the work period closes there, a clock-out
 * entry is appended, and the canonical work record is created with its detail
 * and project allocation, approved with origin `clock` (a live closure never
 * routes approval, #361). Clocking passes the live work it read locked, the
 * instant with its timezone capture, and the attribution of the command.
 */
export type CreateWorkRecord = {
	kind: "create";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	/** The live work, read with `readWorkRecord(..., { lock: true })` in this transaction. */
	completing: CompletingLiveWork;
	/** Where the live work ends. */
	at: Instant;
	/** The command's change of work attribution, on top of what the live work carries. */
	attribution?: WorkAttributionPatch;
	/** Recorded as the canonical work record's creator. */
	recordedBy: string;
	/** The user the effects name (send-back); null for a job or the system. */
	actorUserId: string | null;
	/** The clock-out entry's provenance and the capture of `at`. */
	entries: NewEntryProvenance;
	/** The operation identity the clock-out entry takes; generated when omitted. */
	clockOutEntryId?: string;
	/** The append position's record of the operation that appended the clock-out. */
	appendOperation: TimeEntryAppendOperation;
};

export type CreationPlan = {
	kind: "create";
	completed: PlannedHalf;
};

/**
 * What the completed work and its canonical work record will hold: the live
 * work's interval up to `at`, its minutes rounded half up in both admissions (a
 * live closure always has, #252 §2, #388), approved, with the live work's
 * attribution and the command's patch. The planned pair must agree.
 */
export function planCreation(
	live: CompletingLiveWork,
	change: Pick<CreateWorkRecord, "at" | "attribution">,
	admission: "append" | "legacy",
): CreationPlan | WorkRecordRefusal {
	const startAt = instantFromDate(live.period.startTime);
	const elapsed = compareInstants(change.at, startAt);
	// Legacy admission keeps its established zero-minute work at equal endpoints
	// until it retires (#275, #276); append admission never writes it (#252 §2).
	if (elapsed < 0 || (elapsed === 0 && admission === "append")) {
		return { kind: "instant_outside_work" };
	}
	let attribution: WorkAttribution;
	try {
		attribution = WorkAttribution.fromWorkPeriod(live.period).apply(change.attribution ?? {});
	} catch (error) {
		if (error instanceof UnrepresentableWorkAttributionError) {
			return { kind: "attribution_unrepresentable", reason: error.reason };
		}
		throw error;
	}
	const durationMinutes = elapsed === 0 ? 0 : deriveWorkDurationMinutes(startAt, change.at);
	const completed = plannedHalf({ startAt, endAt: change.at, durationMinutes }, attribution, [], {
		period: "approved",
		record: "approved",
	});
	return plannedPairsRefusal([completed], "planned_half") ?? { kind: "create", completed };
}
