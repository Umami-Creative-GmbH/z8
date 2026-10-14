import "server-only";

/**
 * Work records (Time Tracking ADR 0010): the only writer of completed work and
 * its canonical work record, in both admissions. Two entry points:
 *
 * - `readWorkRecord`: a completed work period with its entries and canonical
 *   work record, its expected state and its record agreement, optionally
 *   locked so a caller can check its own preconditions first.
 * - `applyWorkRecordChange`: one change (today: divide) against a named
 *   expected state. It returns the applied result or a refusal, never both;
 *   `orRefuse` turns a refusal into the error interactive callers throw.
 *
 * Both run only on a sealed work-transaction scope. Work records never opens a
 * transaction and never takes guards (ADR 0001); it takes row locks only, in
 * `WORK_RECORD_LOCK_ORDER`.
 */
import type { SealedWorkTransactionScope } from "../work-transaction";
import type { DivideWorkRecord, WorkRecordChange, WorkRecordRefusal } from "./change";
import { divideWorkRecord, type WorkDivision } from "./divide";
import { divideByOwedBreak, type OwedBreakDivision } from "./divide-owed-break";
import type { DivideByOwedBreak, OwedBreakNotRequired } from "./owed-break";

export type {
	DivideWorkRecord,
	DivisionHalf,
	HalfAttributionOverride,
	NewEntryProvenance,
	WorkRecordChange,
	WorkRecordExpected,
	WorkRecordRefusal,
	WorkRecordRefusalKind,
} from "./change";
export type { AppendedEntryEvidence, DividedHalf, WorkDivision } from "./divide";
export type { OwedBreakDivision } from "./divide-owed-break";
export type {
	DivideByOwedBreak,
	OwedBreak,
	OwedBreakEntryProvenance,
	OwedBreakNotRequired,
	OwedBreakTakenBefore,
} from "./owed-break";
export { readWorkRecord, type WorkRecord } from "./read";
export { CompletedWorkReviewRequiredError, isWorkRecordRefusal, orRefuse } from "./refusals";
export { WORK_RECORD_LOCK_ORDER, type WorkRecordKey } from "./rows";
export type { WorkSegment } from "./segment";

/** The applied result of each change. */
export type WorkRecordResult<C extends WorkRecordChange> = C extends DivideWorkRecord
	? WorkDivision
	: C extends DivideByOwedBreak
		? OwedBreakDivision | OwedBreakNotRequired
		: never;

export async function applyWorkRecordChange<C extends WorkRecordChange>(
	scope: SealedWorkTransactionScope,
	change: C,
): Promise<WorkRecordResult<C> | WorkRecordRefusal> {
	switch (change.kind) {
		case "divide":
			return (await divideWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
		case "divide_owed_break":
			return (await divideByOwedBreak(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
	}
}
