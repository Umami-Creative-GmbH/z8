/**
 * The vocabulary of dividing completed work by an owed break (ADR 0010, #1220):
 * the change a caller asks for and the break work records places. Types only,
 * no I/O and no server-only imports.
 *
 * The caller states policy: the work policy regulation in force for the work,
 * how breaks already taken are counted, the break entries' notes and
 * provenance. Work records counts the breaks taken, plans the owed break with
 * the automatic-break planner, divides both records around it, carries vehicle
 * use across it, marks the work auto-adjusted and applies the effects.
 */
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { BreakPolicyRegulation, BreakPolicyRule } from "../break-policy-calculation";
import type { TimeEntryTimezoneSource } from "../timezone-capture";
import type { WorkRecordExpected } from "./change";

/**
 * How breaks already taken are counted before the owed break is worked out. The
 * two values keep each caller's established rule; unifying them is a product
 * decision of its own (spec #1212).
 *
 * - `earlier_breaks` (automatic break): the gaps of more than a minute between
 *   the employee's completed, kept work of the work's local start day, up to
 *   its end, in the zone captured with its start.
 * - `approved_work_of_local_day` (terminal break, #1221): the gaps between the
 *   approved work of the local day the work ends on, in the entries' zone.
 */
export type OwedBreakTakenBefore = "earlier_breaks" | "approved_work_of_local_day";

/**
 * Who records the two break entries and the zone their instants are captured
 * in. The offset of each entry is resolved at its own instant, so a break
 * across a daylight-saving change captures each side correctly.
 */
export type OwedBreakEntryProvenance = {
	createdBy: string;
	ipAddress: string | null;
	deviceInfo: string | null;
	timezone: string;
	timezoneSource: Exclude<TimeEntryTimezoneSource, "browser">;
};

/**
 * Divide completed work by the break a work policy regulation still owes. The
 * retained half keeps the work period, its clock-in and its canonical work
 * record and ends where the break starts; the generated half starts where it
 * ends and keeps the source clock-out. Both halves are marked auto-adjusted.
 * Nothing owed is the `not_required` outcome, with nothing written.
 */
export type DivideByOwedBreak = {
	kind: "divide_owed_break";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	/** The regulation in force for the work; null when none applies (nothing owed). */
	regulation: BreakPolicyRegulation | null;
	takenBefore: OwedBreakTakenBefore;
	/** The notes of both break entries. */
	notes: string | null;
	/** The user making the change; null for a job or the system. */
	actorUserId: string | null;
	entries: OwedBreakEntryProvenance;
	/** The append position's record of the operation that appended the entries. */
	appendOperation: TimeEntryAppendOperation;
};

/** The break work records placed, as receipts record it. */
export type OwedBreak = {
	breakMinutes: number;
	alreadyTakenBreakMinutes: number;
	rule: BreakPolicyRule;
	regulation: { id: string; name: string };
	startAt: Instant;
	endAt: Instant;
};

/** No break is owed: nothing was written. */
export type OwedBreakNotRequired = { kind: "not_required" };
