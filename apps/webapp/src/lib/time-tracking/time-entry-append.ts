/**
 * Internal append collaborator (#262/#273). Under the caller's employee
 * coordination it admits one fresh append from evidence, returns the exact
 * predecessor identity and hash, and advances the versioned append position in
 * the same transaction. Callers never choose the head; a failed operation rolls
 * the position back with its work.
 *
 * Without a position, the complete employee history is classified: genuinely
 * empty history or one verified lineage is admitted; anything else returns an
 * employee-scoped review requirement. With a position, its exact tip and entry
 * count are the evidence: a change made outside this collaborator holds fresh
 * appends for investigation instead of silently re-admitting history.
 */
import { and, count, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { timeEntry, timeEntryAppendPosition, workPeriod } from "@/db/schema";
import type {
	TimeEntryAppendAdmission,
	TimeEntryAppendOperation,
} from "@/db/schema/time-entry-append";
import { type AppendLineageIssue, type AppendScope, classifyAppendLineage } from "./append-lineage";
import { verifyHash } from "./blockchain";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AppendClient = Pick<Transaction, "select" | "insert" | "update">;

export type AppendReviewReason =
	| AppendLineageIssue
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
	const scoped = and(
		eq(timeEntry.organizationId, scope.organizationId),
		eq(timeEntry.employeeId, scope.employeeId),
	);
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
	const review = (reasons: AppendReviewReason[]) => ({
		kind: "review_required" as const,
		requirement: { ...scope, reasons },
	});

	if (position) {
		const reasons: AppendReviewReason[] = [];
		const [tip] = await client
			.select()
			.from(timeEntry)
			.where(and(eq(timeEntry.id, position.tipEntryId), scoped))
			.limit(1);
		if (!tip) {
			reasons.push({ kind: "position_tip_missing", tipEntryId: position.tipEntryId });
		} else if (tip.hash !== position.tipHash || !verifyHash(tip).isValid) {
			reasons.push({ kind: "position_tip_changed", tipEntryId: tip.id });
		}
		const [history] = await client.select({ entries: count() }).from(timeEntry).where(scoped);
		const actualEntryCount = history?.entries ?? 0;
		if (actualEntryCount !== position.entryCount) {
			reasons.push({
				kind: "unexpected_history_change",
				expectedEntryCount: position.entryCount,
				actualEntryCount,
			});
		}
		if (reasons.length > 0 || !tip) return review(reasons);
		return {
			kind: "admitted",
			append: createAppend(
				client,
				scope,
				operation,
				{ id: tip.id, hash: tip.hash },
				{
					version: position.version,
					entryCount: position.entryCount,
				},
			),
		};
	}

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
		.where(scoped);
	const lineage = classifyAppendLineage(scope, evidence);
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
	}
	return {
		kind: "admitted",
		append: createAppend(
			client,
			scope,
			operation,
			lineage.kind === "lineage" ? lineage.tip : null,
			null,
			{
				admission: lineage.kind === "lineage" ? "verified_lineage" : "empty_history",
				admittedEntryCount: lineage.kind === "lineage" ? lineage.entryCount : 0,
			},
		),
	};
}

function createAppend(
	client: AppendClient,
	scope: AppendScope,
	operation: TimeEntryAppendOperation,
	initialPredecessor: AppendPredecessor | null,
	initialPosition: PositionState | null,
	admission?: {
		admission: TimeEntryAppendAdmission;
		admittedEntryCount: number;
	},
): TimeEntryAppend {
	let predecessor = initialPredecessor;
	let position = initialPosition;
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
			} else if (admission) {
				[advanced] = await client
					.insert(timeEntryAppendPosition)
					.values({
						organizationId: scope.organizationId,
						employeeId: scope.employeeId,
						tipEntryId: entry.id,
						tipHash: entry.hash,
						version: 1,
						entryCount: admission.admittedEntryCount + 1,
						admission: admission.admission,
						admittedEntryCount: admission.admittedEntryCount,
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
