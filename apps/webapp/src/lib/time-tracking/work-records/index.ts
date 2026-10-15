import "server-only";

/**
 * Work records (Time Tracking ADR 0010): the only writer of completed work and
 * its canonical work record, in both admissions. Two entry points:
 *
 * - `readWorkRecord`: a completed work period with its entries and canonical
 *   work record, its expected state and its record agreement, optionally
 *   locked so a caller can check its own preconditions first.
 * - `applyWorkRecordChange`: one change (divide, divide by an owed break,
 *   amend, create from live work, create new work, delete, attach a missing
 *   canonical work record, repair a pair) against a named expected state. It
 *   returns the applied result or a
 *   refusal, never both;
 *   `orRefuse` turns a refusal into the error interactive callers throw.
 *
 * Besides them, `eraseEmployeeWorkHistory` removes an employee's whole work
 * history (demo cleanup, #1223), `advanceWorkRevision` advances a period's
 * revision for a pending correction's transition, and `correctOpenWorkRecord`
 * moves the start of an open canonical work record some history gave live
 * work (#1230).
 *
 * All run only on a sealed work-transaction scope; the Approvals finalizer's
 * database handle becomes one through `workRecordScopeForFinalizer`. Work
 * records never opens a transaction and never takes guards (ADR 0001); it
 * takes row locks only, in
 * `WORK_RECORD_LOCK_ORDER`.
 */
import type { SealedWorkTransactionScope } from "../work-transaction";
import type { DivideWorkRecord, WorkRecordChange, WorkRecordRefusal } from "./change";
import type { AmendWorkRecord } from "./amend-change";
import { amendWorkRecord, type WorkAmendment } from "./amend";
import { createWorkRecord, type WorkCreation } from "./create";
import { createNewWorkRecord, type NewWorkCreation } from "./create-new";
import type { CreateNewWork } from "./create-new-plan";
import type { CreateWorkRecord } from "./create-plan";
import { deleteWorkRecord, type WorkDeletion } from "./delete";
import type { DeleteWorkRecord } from "./delete-change";
import { divideWorkRecord, type WorkDivision } from "./divide";
import { divideByOwedBreak, type OwedBreakDivision } from "./divide-owed-break";
import type { DivideByOwedBreak, OwedBreakNotRequired } from "./owed-break";
import {
	attachWorkRecord,
	repairWorkRecord,
	type WorkAttachment,
	type WorkRepair,
} from "./repair";
import type { AttachWorkRecord, RepairWorkRecord } from "./repair-change";

export {
	type AdoptedEndpoint,
	type AmendAttributionPatch,
	type AmendedEndpoint,
	type AmendedTimes,
	type AmendmentChanges,
	type AmendWorkRecord,
	isAdoptedEndpoint,
	type NewAmendedEndpoint,
	type ToleratedDrift,
	type WorkApprovalDecision,
} from "./amend-change";
export type { AmendedEntryEvidence, WorkAmendment } from "./amend";
export type { WorkDeletion } from "./delete";
export type { DeleteWorkRecord } from "./delete-change";

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
export type { WorkCreation } from "./create";
export type { NewWorkCreation } from "./create-new";
export type {
	CreateNewWork,
	NewWorkApproval,
	NewWorkEndpoint,
	NewWorkOrigin,
} from "./create-new-plan";
export type { CompletingLiveWork, CreateWorkRecord } from "./create-plan";
export type { AppendedEntryEvidence, DividedHalf, WorkDivision } from "./divide";
export type { OwedBreakDivision } from "./divide-owed-break";
export {
	type EmployeeWorkHistoryErasure,
	eraseEmployeeWorkHistory,
} from "./erase-history";
export { workRecordScopeForFinalizer } from "./finalizer-scope";
export type {
	DivideByOwedBreak,
	OwedBreak,
	OwedBreakEntryProvenance,
	OwedBreakNotRequired,
	OwedBreakTakenBefore,
} from "./owed-break";
export { readWorkRecord, type WorkRecord } from "./read";
export { advanceWorkRevision } from "./revision";
export { correctOpenWorkRecord, type OpenWorkRecordCorrection } from "./open-record";
export {
	CompletedWorkReviewRequiredError,
	isWorkRecordRefusal,
	orRefuse,
	refusalError,
} from "./refusals";
export { WORK_RECORD_LOCK_ORDER, type WorkRecordKey } from "./rows";
export type { WorkSegment } from "./segment";
export type { WorkAttributionPatch } from "./work-attribution";

export type { WorkAttachment, WorkRepair } from "./repair";
export type {
	AttachWorkRecord,
	RepairWorkRecord,
	WorkRecordResolution,
} from "./repair-change";

/** The applied result of each change. */
export type WorkRecordResult<C extends WorkRecordChange> = C extends DivideWorkRecord
	? WorkDivision
	: C extends DivideByOwedBreak
		? OwedBreakDivision | OwedBreakNotRequired
		: C extends AmendWorkRecord
			? WorkAmendment
			: C extends CreateWorkRecord
				? WorkCreation
				: C extends CreateNewWork
					? NewWorkCreation
					: C extends AttachWorkRecord
						? WorkAttachment
						: C extends RepairWorkRecord
							? WorkRepair
							: C extends DeleteWorkRecord
								? WorkDeletion
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
		case "amend":
			return (await amendWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
		case "create":
			return (await createWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
		case "create_new":
			return (await createNewWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
		case "attach":
			return (await attachWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
		case "repair":
			return (await repairWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
		case "delete":
			return (await deleteWorkRecord(scope, change)) as WorkRecordResult<C> | WorkRecordRefusal;
	}
}
