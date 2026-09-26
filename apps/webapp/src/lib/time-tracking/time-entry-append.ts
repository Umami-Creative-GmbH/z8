/**
 * Internal append collaborator (#262/#273). Under the caller's employee
 * coordination it admits one fresh append from evidence, returns the exact
 * predecessor identity and hash, and advances the versioned append position in
 * the same transaction. Callers never choose the head; a failed operation rolls
 * the position back with its work.
 *
 * The complete employee history is classified on every admission. Without a
 * position, genuinely empty history or one verified lineage is admitted; anything
 * else returns an employee-scoped review requirement. With a position, history
 * must still be that one lineage, ending at the recorded tip with the recorded
 * entry count: a change made outside this collaborator holds fresh appends for
 * investigation instead of silently re-admitting history. A position established
 * by an authorized continuation (#323) instead requires uninterrupted continuity
 * from its approved anchor with the disclosed earlier history unchanged; the
 * collaborator never establishes a continuation itself.
 */
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { timeEntry, timeEntryAppendPosition, workPeriod } from "@/db/schema";
import type {
	TimeEntryAppendAdmission,
	TimeEntryAppendOperation,
} from "@/db/schema/time-entry-append";
import {
	type AppendContinuityInterruption,
	appendPositionEvidenceOf,
	assessAppendAssurance,
} from "./append-assurance";
import { type AppendLineageIssue, type AppendScope, classifyAppendLineage } from "./append-lineage";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AppendClient = Pick<Transaction, "select" | "insert" | "update">;

export type AppendReviewReason =
	| AppendLineageIssue
	| AppendContinuityInterruption
	| { kind: "history_without_entries" }
	| { kind: "position_tip_missing"; tipEntryId: string }
	| { kind: "position_tip_changed"; tipEntryId: string }
	| {
			kind: "unexpected_history_change";
			expectedEntryCount: number;
			actualEntryCount: number;
	  };

/** Actionable for authorized operators; ordinary users only see that review is required. */
export interface AppendReviewRequirement extends AppendScope {
	reasons: AppendReviewReason[];
}

export class TimeEntryAppendReviewRequiredError extends Error {
	constructor(readonly requirement: AppendReviewRequirement) {
		super("Time entry history requires review before a fresh append");
		this.name = "TimeEntryAppendReviewRequiredError";
	}
}

export class TimeEntryAppendPositionChangedError extends Error {
	constructor() {
		super("Time entry append position changed during the operation");
		this.name = "TimeEntryAppendPositionChangedError";
	}
}

export type AppendPredecessor = { id: string; hash: string };

export type AppendedEntry = {
	id: string;
	hash: string;
	previousEntryId: string | null;
	previousHash: string | null;
};

export interface TimeEntryAppend {
	/** Exact predecessor for the next fresh entry; null only for admitted empty history. */
	readonly predecessor: AppendPredecessor | null;
	/**
	 * Advances the position to an entry this operation just created from
	 * `predecessor`. Multi-entry operations record each entry in turn.
	 */
	record(entry: AppendedEntry): Promise<void>;
}

export type TimeEntryAppendAdmissionResult =
	| { kind: "admitted"; append: TimeEntryAppend }
	| { kind: "review_required"; requirement: AppendReviewRequirement };

type PositionState = {
	version: number;
	entryCount: number;
};

export async function admitTimeEntryAppend(
	client: AppendClient,
	scope: AppendScope,
	operation: TimeEntryAppendOperation,
): Promise<TimeEntryAppendAdmissionResult> {
	const [position] = await client
		.select()
		.from(timeEntryAppendPosition)
		.where(
			and(
				eq(timeEntryAppendPosition.organizationId, scope.organizationId),
				eq(timeEntryAppendPosition.employeeId, scope.employeeId),
			),
		)
		.for("update")
		.limit(1);
	// Retained inactive (superseded, cancelled, rejected) entries are evidence too.
	const evidence = await client
		.select({
			id: timeEntry.id,
			organizationId: timeEntry.organizationId,
			employeeId: timeEntry.employeeId,
			type: timeEntry.type,
			timestamp: timeEntry.timestamp,
			hash: timeEntry.hash,
			previousHash: timeEntry.previousHash,
			previousEntryId: timeEntry.previousEntryId,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, scope.organizationId),
				eq(timeEntry.employeeId, scope.employeeId),
			),
		);
	const review = (reasons: AppendReviewReason[]) => ({
		kind: "review_required" as const,
		requirement: { ...scope, reasons },
	});

	if (position?.admission === "authorized_continuation") {
		// Disclosed pre-anchor issues do not block; anything new after the anchor does.
		const { continuity } = assessAppendAssurance({
			scope,
			entries: evidence,
			position: appendPositionEvidenceOf(position),
			hasWork: true,
		});
		const recordedTip = evidence.find((entry) => entry.id === position.tipEntryId);
		if (continuity.status !== "established" || !recordedTip) {
			return review(continuity.status === "interrupted" ? continuity.reasons : []);
		}
		return {
			kind: "admitted",
			append: createAppend(client, scope, operation, {
				predecessor: { id: recordedTip.id, hash: recordedTip.hash },
				position: { version: position.version, entryCount: position.entryCount },
			}),
		};
	}

	const lineage = classifyAppendLineage(scope, evidence);
	if (position) {
		const reasons: AppendReviewReason[] = [];
		const recordedTip = evidence.find((entry) => entry.id === position.tipEntryId);
		if (!recordedTip) {
			reasons.push({ kind: "position_tip_missing", tipEntryId: position.tipEntryId });
		} else if (recordedTip.hash !== position.tipHash) {
			reasons.push({ kind: "position_tip_changed", tipEntryId: recordedTip.id });
		}
		if (lineage.kind === "review_required") reasons.push(...lineage.issues);
		// Anything written after the recorded tip bypassed this collaborator.
		const tipHasSuccessor = evidence.some(
			(entry) =>
				entry.id !== position.tipEntryId &&
				(entry.previousEntryId === position.tipEntryId ||
					(entry.previousEntryId === null && entry.previousHash === position.tipHash)),
		);
		if (evidence.length !== position.entryCount || tipHasSuccessor) {
			reasons.push({
				kind: "unexpected_history_change",
				expectedEntryCount: position.entryCount,
				actualEntryCount: evidence.length,
			});
		}
		if (reasons.length > 0 || !recordedTip) return review(reasons);
		return {
			kind: "admitted",
			append: createAppend(client, scope, operation, {
				predecessor: { id: recordedTip.id, hash: recordedTip.hash },
				position: { version: position.version, entryCount: position.entryCount },
			}),
		};
	}

	if (lineage.kind === "review_required") return review(lineage.issues);
	if (lineage.kind === "empty") {
		const [period] = await client
			.select({ id: workPeriod.id })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, scope.organizationId),
					eq(workPeriod.employeeId, scope.employeeId),
				),
			)
			.limit(1);
		// Work without any entries means earlier history is missing, not empty.
		if (period) return review([{ kind: "history_without_entries" }]);
		return {
			kind: "admitted",
			append: createAppend(client, scope, operation, {
				predecessor: null,
				establishes: { admission: "empty_history", anchor: null, entryCount: 0 },
			}),
		};
	}
	return {
		kind: "admitted",
		append: createAppend(client, scope, operation, {
			predecessor: lineage.tip,
			establishes: {
				admission: "verified_lineage",
				anchor: lineage.tip,
				entryCount: lineage.entryCount,
			},
		}),
	};
}

/** How a first append establishes the position: its admission and the anchor it follows. */
type PositionEstablishment = {
	admission: TimeEntryAppendAdmission;
	anchor: AppendPredecessor | null;
	entryCount: number;
};

function createAppend(
	client: AppendClient,
	scope: AppendScope,
	operation: TimeEntryAppendOperation,
	start:
		| { predecessor: AppendPredecessor; position: PositionState }
		| { predecessor: AppendPredecessor | null; establishes: PositionEstablishment },
): TimeEntryAppend {
	let predecessor = start.predecessor;
	let position = "position" in start ? start.position : null;
	const establishes = "establishes" in start ? start.establishes : null;
	return {
		get predecessor() {
			return predecessor;
		},
		async record(entry) {
			if (
				entry.previousEntryId !== (predecessor?.id ?? null) ||
				entry.previousHash !== (predecessor?.hash ?? null)
			) {
				throw new Error("Appended entry does not follow the admitted predecessor");
			}
			let advanced: PositionState | undefined;
			if (position) {
				[advanced] = await client
					.update(timeEntryAppendPosition)
					.set({
						tipEntryId: entry.id,
						tipHash: entry.hash,
						version: position.version + 1,
						entryCount: position.entryCount + 1,
						lastOperation: operation,
						updatedAt: sql`now()`,
					})
					.where(
						and(
							eq(timeEntryAppendPosition.organizationId, scope.organizationId),
							eq(timeEntryAppendPosition.employeeId, scope.employeeId),
							eq(timeEntryAppendPosition.version, position.version),
						),
					)
					.returning({
						version: timeEntryAppendPosition.version,
						entryCount: timeEntryAppendPosition.entryCount,
					});
			} else if (establishes) {
				[advanced] = await client
					.insert(timeEntryAppendPosition)
					.values({
						organizationId: scope.organizationId,
						employeeId: scope.employeeId,
						tipEntryId: entry.id,
						tipHash: entry.hash,
						version: 1,
						entryCount: establishes.entryCount + 1,
						admission: establishes.admission,
						admittedTipEntryId: establishes.anchor?.id ?? null,
						admittedTipHash: establishes.anchor?.hash ?? null,
						admittedEntryCount: establishes.entryCount,
						admittedOperation: operation,
						admittedAt: sql`now()`,
						lastOperation: operation,
						updatedAt: sql`now()`,
					})
					.onConflictDoNothing()
					.returning({
						version: timeEntryAppendPosition.version,
						entryCount: timeEntryAppendPosition.entryCount,
					});
			}
			if (!advanced) throw new TimeEntryAppendPositionChangedError();
			position = advanced;
			predecessor = { id: entry.id, hash: entry.hash };
		},
	};
}
