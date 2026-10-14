/**
 * Separately authorized explicit historical proposals (#260 §9, #262 §4, #323).
 *
 * Two kinds share one lifecycle:
 *
 * - `field_repair`: exact before/after changes to one work (`historical-repair-proposal.ts`);
 * - `append_continuation`: future appends continue from one exact existing anchor
 *   entry (`append-continuation.ts`).
 *
 * An organization administrator creates a proposal from current evidence, and an
 * administrator (the proposer included) approves that exact proposal by its
 * fingerprint. Creating and approving write nothing but the proposal. Application
 * needs the organization's separate repair authorization
 * (`historical_work_repair_control`) and runs through the shared completed-work
 * coordinator: adoption gate, configuration and user guards, then the employee's
 * coordination key, so participating writers are drained for that employee. Under
 * those locks it re-reads the evidence, rebuilds the proposal and continues only
 * when the fingerprint is unchanged; otherwise the proposal becomes `stale` and
 * nothing else is written. A field repair writes through work records (#1226):
 * both records take the repaired values in one revision step, with the effects of
 * any change to work, and its receipt and outcome commit with them. A continuation
 * establishes the append position at its anchor with its provenance. Applying
 * again returns the recorded outcome.
 *
 * Committed replay never calls this module. Nothing here rechains, rehashes,
 * deletes, relinks, starts approval workflows or reconstructs decisions.
 */
import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { db as database } from "@/db";
import { user } from "@/db/auth-schema";
import {
	completedWorkOperation,
	historicalWorkProposal,
	historicalWorkRepairControl,
	project,
	timeEntry,
	timeEntryAppendPosition,
	timeRecordAllocation,
	workCategory,
	workPeriod,
} from "@/db/schema";
import type {
	HistoricalWorkProposalKind,
	HistoricalWorkProposalStatus,
} from "@/db/schema/completed-work";
import { systemClock } from "@/lib/datetime/temporal-core";
import { withAppendEvidenceSnapshot } from "./append-assurance-reader";
import {
	type AppendContinuationPlan,
	type AppendContinuationProposal,
	type AppendContinuationRefusal,
	planAppendContinuation,
} from "./append-continuation";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { HistoricalRepairNotAuthorizedError } from "./historical-gap-repair-executor";
import {
	type HistoricalRepairProposal,
	type HistoricalRepairProposalResult,
	type HistoricalRepairRefusal,
	type HistoricalRepairRequest,
	proposeHistoricalRepair,
	type RequestedRepairChange,
} from "./historical-repair-proposal";
import { fieldRepairResolution } from "./historical-repair-resolution";
import {
	type HistoricalWorkEvidenceReader,
	readHistoricalWorkEvidence,
} from "./historical-work-diagnostics-reader";
import { applyWorkRecordChange, isWorkRecordRefusal } from "./work-records";
import { refusalError } from "./work-records/refusals";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "./work-transaction";

type Database = typeof database;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Reader = HistoricalWorkEvidenceReader;

export const HISTORICAL_REPAIR_PROPOSAL_WRITER_VERSION = 1;
export const HISTORICAL_REPAIR_PROPOSAL_COMMAND_VERSION = 1;
export const HISTORICAL_REPAIR_PROPOSAL_RESULT_VERSION = 1;

export type ProposalRefusal = HistoricalRepairRefusal | AppendContinuationRefusal;

/** The proposal cannot be created from current evidence; nothing was written. */
export class HistoricalProposalRefusedError extends Error {
	constructor(readonly reasons: ProposalRefusal[]) {
		super(`Historical proposal refused: ${reasons.join(", ")}`);
		this.name = "HistoricalProposalRefusedError";
	}
}

export type HistoricalProposalConflictCode =
	/** The proposal ID is already used for different content. */
	| "proposal_id_conflict"
	/** The reviewed fingerprint is not the proposal's. */
	| "fingerprint_mismatch"
	/** The transition is not allowed from the proposal's current status. */
	| "invalid_status"
	/** A continuation only applies where fresh appends use evidence-based admission. */
	| "append_not_adopted";

export class HistoricalProposalConflictError extends Error {
	constructor(
		readonly code: HistoricalProposalConflictCode,
		readonly status?: HistoricalWorkProposalStatus,
	) {
		super(`Historical proposal conflict: ${code}`);
		this.name = "HistoricalProposalConflictError";
	}
}

export class HistoricalProposalNotFoundError extends Error {
	constructor() {
		super("Historical proposal or its work was not found in this organization");
		this.name = "HistoricalProposalNotFoundError";
	}
}

/** A guarded write found state other than the reviewed proposal expected. */
class StaleHistoricalProposalError extends Error {
	constructor() {
		super("Historical proposal is stale");
		this.name = "StaleHistoricalProposalError";
	}
}

export type StoredProposalContent = HistoricalRepairProposal | AppendContinuationProposal;

export interface HistoricalWorkProposalView {
	id: string;
	employeeId: string;
	kind: HistoricalWorkProposalKind;
	status: HistoricalWorkProposalStatus;
	workPeriodId: string | null;
	fingerprint: string;
	proposal: StoredProposalContent;
	reason: string;
	proposedBy: { id: string; name: string | null };
	proposedAt: string;
	approvedBy: { id: string; name: string | null } | null;
	approvedAt: string | null;
	resolvedBy: { id: string; name: string | null } | null;
	resolvedAt: string | null;
	outcome: Record<string, unknown> | null;
}

type ProposalRow = typeof historicalWorkProposal.$inferSelect;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readRepairAuthorization(reader: Reader, organizationId: string) {
	const [control] = await reader
		.select({ mode: historicalWorkRepairControl.mode })
		.from(historicalWorkRepairControl)
		.where(eq(historicalWorkRepairControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active";
}

/** Proposals of the organization (optionally one employee), newest first. */
export async function listHistoricalWorkProposals(
	db: Database,
	organizationId: string,
	employeeId: string | null,
): Promise<{ proposals: HistoricalWorkProposalView[]; authorized: boolean }> {
	return withAppendEvidenceSnapshot(db, async (reader) => {
		const rows = await reader
			.select()
			.from(historicalWorkProposal)
			.where(
				employeeId
					? and(
							eq(historicalWorkProposal.organizationId, organizationId),
							eq(historicalWorkProposal.employeeId, employeeId),
						)
					: eq(historicalWorkProposal.organizationId, organizationId),
			)
			.orderBy(desc(historicalWorkProposal.proposedAt), historicalWorkProposal.id)
			.limit(200);
		const userIds = [
			...new Set(
				rows.flatMap((row) =>
					[row.proposedBy, row.approvedBy, row.resolvedBy].filter(
						(value): value is string => value !== null,
					),
				),
			),
		];
		const names = new Map<string, string | null>();
		if (userIds.length > 0) {
			const users = await reader
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, userIds));
			for (const row of users) names.set(row.id, row.name);
		}
		const actor = (id: string | null) => (id ? { id, name: names.get(id) ?? null } : null);
		return {
			proposals: rows.map((row) => ({
				...viewOf(row),
				proposedBy: actor(row.proposedBy) as { id: string; name: string | null },
				approvedBy: actor(row.approvedBy),
				resolvedBy: actor(row.resolvedBy),
			})),
			authorized: await readRepairAuthorization(reader, organizationId),
		};
	});
}

function viewOf(row: ProposalRow): HistoricalWorkProposalView {
	return {
		id: row.id,
		employeeId: row.employeeId,
		kind: row.kind,
		status: row.status,
		workPeriodId: row.workPeriodId,
		fingerprint: row.fingerprint,
		proposal: row.proposal as unknown as StoredProposalContent,
		reason: row.reason,
		proposedBy: { id: row.proposedBy, name: null },
		proposedAt: row.proposedAt.toISOString(),
		approvedBy: row.approvedBy ? { id: row.approvedBy, name: null } : null,
		approvedAt: row.approvedAt?.toISOString() ?? null,
		resolvedBy: row.resolvedBy ? { id: row.resolvedBy, name: null } : null,
		resolvedAt: row.resolvedAt?.toISOString() ?? null,
		outcome: row.outcome ?? null,
	};
}

/** Organization-owned projects and categories among the requested new values. */
async function readRequestReferences(
	reader: Reader,
	organizationId: string,
	changes: readonly RequestedRepairChange[],
) {
	// Only UUIDs can name a row; anything else is simply not the organization's.
	const requested = (field: RequestedRepairChange["field"]) =>
		changes.flatMap((change) =>
			change.field === field && typeof change.after === "string" && UUID.test(change.after)
				? [change.after]
				: [],
		);
	const projectIds = requested("project_id");
	const workCategoryIds = requested("work_category_id");
	const owned = { projectIds: new Set<string>(), workCategoryIds: new Set<string>() };
	if (projectIds.length > 0) {
		const rows = await reader
			.select({ id: project.id })
			.from(project)
			.where(and(eq(project.organizationId, organizationId), inArray(project.id, projectIds)));
		for (const row of rows) owned.projectIds.add(row.id);
	}
	if (workCategoryIds.length > 0) {
		const rows = await reader
			.select({ id: workCategory.id })
			.from(workCategory)
			.where(
				and(
					eq(workCategory.organizationId, organizationId),
					inArray(workCategory.id, workCategoryIds),
				),
			);
		for (const row of rows) owned.workCategoryIds.add(row.id);
	}
	return owned;
}

async function buildRepairProposal(
	reader: Reader,
	organizationId: string,
	employeeId: string,
	request: HistoricalRepairRequest,
): Promise<HistoricalRepairProposalResult> {
	const evidence = await readHistoricalWorkEvidence(reader, organizationId, [employeeId]);
	const references = await readRequestReferences(reader, organizationId, request.changes);
	return proposeHistoricalRepair({ evidence, references, request });
}

async function buildContinuationProposal(
	reader: Reader,
	scope: { organizationId: string; employeeId: string },
	anchor: { entryId: string; hash: string },
): Promise<AppendContinuationPlan> {
	const entries = await reader
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
	const [position] = await reader
		.select({ version: timeEntryAppendPosition.version })
		.from(timeEntryAppendPosition)
		.where(
			and(
				eq(timeEntryAppendPosition.organizationId, scope.organizationId),
				eq(timeEntryAppendPosition.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	const [work] = await reader
		.select({
			any: sql<boolean>`true`,
			active: sql<boolean>`coalesce(bool_or(${workPeriod.isActive} and ${workPeriod.deletedAt} is null), false)`,
			pendingCorrection: sql<boolean>`coalesce(bool_or(${workPeriod.pendingChanges} is not null and ${workPeriod.deletedAt} is null), false)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
			),
		)
		.groupBy(workPeriod.employeeId);
	return planAppendContinuation({
		scope,
		entries,
		positionExists: position !== undefined,
		hasWork: work !== undefined,
		pending: {
			activeWork: work?.active ?? false,
			pendingCorrection: work?.pendingCorrection ?? false,
		},
		anchor,
	});
}

/** Rebuilds a stored proposal from current evidence with its original request. */
async function rebuild(reader: Reader, row: ProposalRow) {
	const scope = { organizationId: row.organizationId, employeeId: row.employeeId };
	if (row.kind === "append_continuation") {
		const proposal = row.proposal as unknown as AppendContinuationProposal;
		return buildContinuationProposal(reader, scope, {
			entryId: proposal.anchor.entryId,
			hash: proposal.anchor.hash,
		});
	}
	const proposal = row.proposal as unknown as HistoricalRepairProposal;
	return buildRepairProposal(reader, row.organizationId, row.employeeId, requestOf(proposal));
}

function requestOf(proposal: HistoricalRepairProposal): HistoricalRepairRequest {
	return {
		workPeriodId: proposal.work.workPeriodId,
		changes: proposal.changes.map(
			({ target, field, after }) => ({ target, field, after }) as RequestedRepairChange,
		),
		evidenceNote: proposal.evidence.note,
	};
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

interface CreateBase {
	organizationId: string;
	actorUserId: string;
	/** Client-generated identity; repeating a creation returns the same proposal. */
	proposalId: string;
	reason: string;
}

export async function createHistoricalRepairProposal(
	db: Database,
	input: CreateBase & { request: HistoricalRepairRequest },
): Promise<HistoricalWorkProposalView> {
	return db.transaction(async (tx) => {
		const [period] = await tx
			.select({ employeeId: workPeriod.employeeId })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.id, input.request.workPeriodId),
				),
			)
			.limit(1);
		if (!period) throw new HistoricalProposalNotFoundError();
		const result = await buildRepairProposal(
			tx,
			input.organizationId,
			period.employeeId,
			input.request,
		);
		if (result.kind === "refused") throw new HistoricalProposalRefusedError(result.reasons);
		return insertProposal(tx, input, {
			employeeId: period.employeeId,
			kind: "field_repair",
			workPeriodId: input.request.workPeriodId,
			proposal: result.proposal,
			fingerprint: result.fingerprint,
		});
	});
}

export async function createAppendContinuationProposal(
	db: Database,
	input: CreateBase & { employeeId: string; anchor: { entryId: string; hash: string } },
): Promise<HistoricalWorkProposalView> {
	return db.transaction(async (tx) => {
		const plan = await buildContinuationProposal(
			tx,
			{ organizationId: input.organizationId, employeeId: input.employeeId },
			input.anchor,
		);
		if (plan.kind === "refused") throw new HistoricalProposalRefusedError(plan.reasons);
		return insertProposal(tx, input, {
			employeeId: input.employeeId,
			kind: "append_continuation",
			workPeriodId: null,
			proposal: plan.proposal,
			fingerprint: plan.fingerprint,
		});
	});
}

async function insertProposal(
	tx: WorkTransactionClient,
	input: CreateBase,
	content: {
		employeeId: string;
		kind: HistoricalWorkProposalKind;
		workPeriodId: string | null;
		proposal: StoredProposalContent;
		fingerprint: string;
	},
): Promise<HistoricalWorkProposalView> {
	const [inserted] = await tx
		.insert(historicalWorkProposal)
		.values({
			id: input.proposalId,
			organizationId: input.organizationId,
			employeeId: content.employeeId,
			kind: content.kind,
			status: "proposed",
			workPeriodId: content.workPeriodId,
			fingerprint: content.fingerprint,
			proposal: content.proposal as unknown as Record<string, unknown>,
			reason: input.reason,
			proposedBy: input.actorUserId,
			proposedAt: sql`now()`,
		})
		.onConflictDoNothing()
		.returning();
	if (inserted) return viewOf(inserted);
	// A repeated creation returns the proposal it made; a different one is a conflict.
	const [existing] = await tx
		.select()
		.from(historicalWorkProposal)
		.where(eq(historicalWorkProposal.id, input.proposalId))
		.limit(1);
	if (
		!existing ||
		existing.organizationId !== input.organizationId ||
		existing.kind !== content.kind ||
		existing.proposedBy !== input.actorUserId ||
		existing.reason !== input.reason ||
		canonicalRequest(existing) !== canonicalRequest(content)
	) {
		throw new HistoricalProposalConflictError("proposal_id_conflict");
	}
	return viewOf(existing);
}

/** The request a proposal was made from, independent of the evidence it was checked against. */
function canonicalRequest(row: { kind: HistoricalWorkProposalKind; proposal: unknown }) {
	if (row.kind === "append_continuation") {
		const { anchor, scope } = row.proposal as AppendContinuationProposal;
		return JSON.stringify([scope.employeeId, anchor.entryId, anchor.hash]);
	}
	const request = requestOf(row.proposal as HistoricalRepairProposal);
	return JSON.stringify([
		request.workPeriodId,
		request.evidenceNote,
		request.changes.map((change) => [change.target, change.field, change.after]),
	]);
}

// ---------------------------------------------------------------------------
// Approval and rejection
// ---------------------------------------------------------------------------

async function lockProposal(
	tx: WorkTransactionClient,
	organizationId: string,
	proposalId: string,
): Promise<ProposalRow> {
	const [row] = await tx
		.select()
		.from(historicalWorkProposal)
		.where(
			and(
				eq(historicalWorkProposal.organizationId, organizationId),
				eq(historicalWorkProposal.id, proposalId),
			),
		)
		.for("update")
		.limit(1);
	if (!row) throw new HistoricalProposalNotFoundError();
	return row;
}

async function markStale(
	tx: WorkTransactionClient,
	row: ProposalRow,
	actorUserId: string,
	stage: "approval" | "application",
	/** What current evidence yields instead, or null when a guarded write disagreed. */
	current:
		| { kind: "refused"; reasons: ProposalRefusal[] }
		| { kind: "proposal"; fingerprint: string }
		| null,
): Promise<HistoricalWorkProposalView> {
	const [updated] = await tx
		.update(historicalWorkProposal)
		.set({
			status: "stale",
			resolvedBy: actorUserId,
			resolvedAt: sql`now()`,
			outcome: {
				status: "stale",
				stage,
				// What current evidence yields instead of the reviewed proposal.
				current:
					current === null
						? null
						: current.kind === "refused"
							? { refused: current.reasons }
							: { fingerprint: current.fingerprint },
			},
		})
		.where(eq(historicalWorkProposal.id, row.id))
		.returning();
	return viewOf(updated as ProposalRow);
}

export type ProposalTransitionResult = {
	status: "approved" | "rejected" | "stale";
	proposal: HistoricalWorkProposalView;
};

/**
 * Records approval of the exact reviewed proposal. Current evidence is checked
 * first, so an approval never lands on a proposal that is already stale.
 */
export async function approveHistoricalWorkProposal(
	db: Database,
	input: { organizationId: string; actorUserId: string; proposalId: string; fingerprint: string },
): Promise<ProposalTransitionResult> {
	return db.transaction(async (tx) => {
		const row = await lockProposal(tx, input.organizationId, input.proposalId);
		if (row.status !== "proposed") {
			throw new HistoricalProposalConflictError("invalid_status", row.status);
		}
		if (row.fingerprint !== input.fingerprint) {
			throw new HistoricalProposalConflictError("fingerprint_mismatch");
		}
		const current = await rebuild(tx, row);
		if (current.kind === "refused" || current.fingerprint !== row.fingerprint) {
			return {
				status: "stale" as const,
				proposal: await markStale(tx, row, input.actorUserId, "approval", current),
			};
		}
		const [updated] = await tx
			.update(historicalWorkProposal)
			.set({ status: "approved", approvedBy: input.actorUserId, approvedAt: sql`now()` })
			.where(eq(historicalWorkProposal.id, row.id))
			.returning();
		return { status: "approved" as const, proposal: viewOf(updated as ProposalRow) };
	});
}

export async function rejectHistoricalWorkProposal(
	db: Database,
	input: { organizationId: string; actorUserId: string; proposalId: string; note: string },
): Promise<ProposalTransitionResult> {
	return db.transaction(async (tx) => {
		const row = await lockProposal(tx, input.organizationId, input.proposalId);
		if (row.status !== "proposed" && row.status !== "approved") {
			throw new HistoricalProposalConflictError("invalid_status", row.status);
		}
		const [updated] = await tx
			.update(historicalWorkProposal)
			.set({
				status: "rejected",
				resolvedBy: input.actorUserId,
				resolvedAt: sql`now()`,
				outcome: { status: "rejected", note: input.note },
			})
			.where(eq(historicalWorkProposal.id, row.id))
			.returning();
		return { status: "rejected" as const, proposal: viewOf(updated as ProposalRow) };
	});
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type ProposalApplicationResult =
	| { status: "applied"; proposal: HistoricalWorkProposalView }
	/** Applied earlier; the recorded outcome is returned and nothing is written. */
	| { status: "already_applied"; proposal: HistoricalWorkProposalView }
	/** Current evidence no longer yields the approved proposal; nothing else was written. */
	| { status: "stale"; proposal: HistoricalWorkProposalView };

export async function applyHistoricalWorkProposal(
	db: Database,
	input: { organizationId: string; actorUserId: string; proposalId: string },
): Promise<ProposalApplicationResult> {
	const [target] = await db
		.select({ employeeId: historicalWorkProposal.employeeId })
		.from(historicalWorkProposal)
		.where(
			and(
				eq(historicalWorkProposal.organizationId, input.organizationId),
				eq(historicalWorkProposal.id, input.proposalId),
			),
		)
		.limit(1);
	if (!target) throw new HistoricalProposalNotFoundError();
	const employeeId = target.employeeId;

	try {
		return await withCompletedWorkTransaction(
			{ organizationId: input.organizationId, employeeId, actorUserId: input.actorUserId },
			async (scope) => {
				scope.assertEmployee(input.organizationId, employeeId);
				return applyInCoordination(scope, input);
			},
		);
	} catch (error) {
		if (!(error instanceof StaleHistoricalProposalError)) throw error;
		// A guarded write disagreed after the re-check; everything rolled back.
		return db.transaction(async (tx) => {
			const row = await lockProposal(tx, input.organizationId, input.proposalId);
			if (row.status !== "approved") {
				throw new HistoricalProposalConflictError("invalid_status", row.status);
			}
			return {
				status: "stale" as const,
				proposal: await markStale(tx, row, input.actorUserId, "application", null),
			};
		});
	}
}

async function applyInCoordination(
	scope: SealedWorkTransactionScope,
	input: { organizationId: string; actorUserId: string; proposalId: string },
): Promise<ProposalApplicationResult> {
	const { db: tx, admission } = scope;
	const row = await lockProposal(tx, input.organizationId, input.proposalId);
	// A retry returns the recorded outcome even after authorization was withdrawn.
	if (row.status === "applied") return { status: "already_applied", proposal: viewOf(row) };
	if (row.status === "stale") return { status: "stale", proposal: viewOf(row) };
	if (row.status !== "approved") {
		throw new HistoricalProposalConflictError("invalid_status", row.status);
	}
	if (!(await readRepairAuthorization(tx, input.organizationId))) {
		throw new HistoricalRepairNotAuthorizedError();
	}
	if (row.kind === "append_continuation" && admission !== "append") {
		throw new HistoricalProposalConflictError("append_not_adopted");
	}

	// A field repair's rows are locked by work records, in its table order; the
	// employee's coordination key already keeps every other writer out of the re-read.
	if (row.kind === "append_continuation") {
		await tx
			.select({ version: timeEntryAppendPosition.version })
			.from(timeEntryAppendPosition)
			.where(
				and(
					eq(timeEntryAppendPosition.organizationId, row.organizationId),
					eq(timeEntryAppendPosition.employeeId, row.employeeId),
				),
			)
			.for("update");
	}
	const current = await rebuild(tx, row);
	if (current.kind === "refused" || current.fingerprint !== row.fingerprint) {
		return {
			status: "stale",
			proposal: await markStale(tx, row, input.actorUserId, "application", current),
		};
	}

	const outcome =
		row.kind === "field_repair"
			? await applyFieldRepair(scope, input.actorUserId, row)
			: await applyContinuation(tx, row);
	const [updated] = await tx
		.update(historicalWorkProposal)
		.set({
			status: "applied",
			resolvedBy: input.actorUserId,
			resolvedAt: sql`now()`,
			outcome: { status: "applied", ...outcome },
		})
		.where(
			and(eq(historicalWorkProposal.id, row.id), eq(historicalWorkProposal.status, "approved")),
		)
		.returning();
	if (!updated) throw new StaleHistoricalProposalError();
	return { status: "applied", proposal: viewOf(updated) };
}

async function applyFieldRepair(
	scope: SealedWorkTransactionScope,
	executorUserId: string,
	row: ProposalRow,
) {
	const proposal = row.proposal as unknown as HistoricalRepairProposal;
	const { organizationId, employeeId } = proposal.scope;
	const executedAt = systemClock.nowInstant();
	const recordProjects = proposal.expected.record?.projectIds ?? [];
	// A repaired project keeps the task and billability the record's allocation
	// already has; the rebuilt fingerprint proved the allocations unchanged.
	const resolution = fieldRepairResolution(
		proposal.changes,
		await reviewedAllocations(scope.db, organizationId, proposal.work.timeRecordId, recordProjects),
	);
	const sourceRevision = proposal.expected.period.graphRevision;
	const repaired = await applyWorkRecordChange(scope, {
		kind: "repair",
		organizationId,
		employeeId,
		expected: { workPeriodId: proposal.work.workPeriodId, revision: sourceRevision },
		resolution,
		actorUserId: executorUserId,
	});
	if (isWorkRecordRefusal(repaired)) {
		// A closed month is a refusal of its own; anything else means the reviewed
		// work moved, so the proposal is stale and nothing was written.
		if (repaired.kind === "month_closed") throw refusalError(repaired);
		throw new StaleHistoricalProposalError();
	}

	const executor = {
		kind: "human" as const,
		userId: executorUserId,
		executedAt: executedAt.toString(),
	};
	const revisions = {
		workPeriod: { source: repaired.source.revision, result: repaired.after.revision },
	};
	const recordId = proposal.work.timeRecordId;
	// The receipt's identity is the proposal's: one application per approved proposal.
	await scope.db.insert(completedWorkOperation).values({
		id: row.id,
		organizationId,
		employeeId,
		kind: "apply_historical_repair_proposal",
		writer: "historical_repair_proposal",
		writerVersion: HISTORICAL_REPAIR_PROPOSAL_WRITER_VERSION,
		commandVersion: HISTORICAL_REPAIR_PROPOSAL_COMMAND_VERSION,
		command: {
			version: HISTORICAL_REPAIR_PROPOSAL_COMMAND_VERSION,
			proposalId: row.id,
			fingerprint: row.fingerprint,
			reason: row.reason,
		},
		appendAdmission: scope.admission,
		// The operation's actor is its executor; proposer and approver are in the result.
		actorKind: "human",
		actorUserId: executorUserId,
		workPeriodId: proposal.work.workPeriodId,
		resultVersion: HISTORICAL_REPAIR_PROPOSAL_RESULT_VERSION,
		result: {
			version: HISTORICAL_REPAIR_PROPOSAL_RESULT_VERSION,
			disposition: "executed",
			proposalId: row.id,
			workPeriodId: proposal.work.workPeriodId,
			timeRecordId: recordId,
			// The new values come from the operator's evidence, not from an original action.
			originalActor: { kind: "unknown_historical" },
			proposer: { userId: row.proposedBy, proposedAt: row.proposedAt.toISOString() },
			approver: { userId: row.approvedBy, approvedAt: row.approvedAt?.toISOString() ?? null },
			executor,
			reason: row.reason,
			changes: proposal.changes,
			evidence: proposal.evidence,
			uncertainty: proposal.uncertainty,
			consequences: proposal.consequences,
			expected: proposal.expected,
			revisions,
			effects: repaired.effects,
		},
	});
	return { operationId: row.id, executor, revisions };
}

/** The reviewed record's project allocations, as the resolution of a project repair reads them. */
async function reviewedAllocations(
	tx: WorkTransactionClient,
	organizationId: string,
	recordId: string | null,
	projectIds: readonly string[],
) {
	if (recordId === null || projectIds.length === 0) return null;
	const allocations = await tx
		.select({
			allocationKind: timeRecordAllocation.allocationKind,
			projectId: timeRecordAllocation.projectId,
			taskId: timeRecordAllocation.taskId,
			costCenterId: timeRecordAllocation.costCenterId,
			weightPercent: timeRecordAllocation.weightPercent,
			isBillable: timeRecordAllocation.isBillable,
		})
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.organizationId, organizationId),
				eq(timeRecordAllocation.recordId, recordId),
				eq(timeRecordAllocation.allocationKind, "project"),
			),
		);
	return { allocations };
}

async function applyContinuation(tx: WorkTransactionClient, row: ProposalRow) {
	const proposal = row.proposal as unknown as AppendContinuationProposal;
	const { anchor, expected } = proposal;
	// The position starts at the anchor; the first fresh append follows it.
	const [position] = await tx
		.insert(timeEntryAppendPosition)
		.values({
			organizationId: row.organizationId,
			employeeId: row.employeeId,
			tipEntryId: anchor.entryId,
			tipHash: anchor.hash,
			version: 1,
			entryCount: expected.entryCount,
			admission: "authorized_continuation",
			admittedTipEntryId: anchor.entryId,
			admittedTipHash: anchor.hash,
			admittedEntryCount: expected.entryCount,
			admittedHistoryDigest: expected.historyDigest,
			continuationProposalId: row.id,
			admittedOperation: "authorized_continuation",
			admittedAt: sql`now()`,
			lastOperation: "authorized_continuation",
			updatedAt: sql`now()`,
		})
		.onConflictDoNothing()
		.returning({
			version: timeEntryAppendPosition.version,
			admittedAt: timeEntryAppendPosition.admittedAt,
		});
	if (!position) throw new StaleHistoricalProposalError();
	return {
		position: {
			anchor: { entryId: anchor.entryId, hash: anchor.hash },
			entryCount: expected.entryCount,
			version: position.version,
			admittedAt: position.admittedAt.toISOString(),
		},
	};
}
