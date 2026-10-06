import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	type TravelExpenseExportBatchStatus,
	type TravelExpenseExportBatchTotal,
	travelExpenseExportBatch,
	travelExpenseExportBatchRevision,
} from "@/db/schema";
import { loadTravelExpenseReportSubmittedRevision } from "@/lib/approvals/evidence/travel-expense-report-store";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	sortManifestRevisions,
	TRAVEL_EXPENSE_EXPORT_MANIFEST_VERSION,
	type TravelExpenseExportManifest,
	type TravelExpenseExportManifestRevision,
	travelExpenseExportManifestDigest,
	travelExpenseExportSelectionFingerprint,
} from "./export-manifest";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";
import {
	listFinanceQueue,
	loadSettlementAccount,
	type SettlementAccount,
} from "./settlement-store";

/**
 * Tracked export batches of approved travel expense report revisions (#613).
 *
 * A batch is created from finance's selection under the same report row locks
 * settlement takes (`loadSettlementAccount(…, {lock: true})`): each selected
 * revision must be the report's approved current revision, and must not be
 * part of another batch that is not cancelled. The batch stores the full
 * frozen facts in its manifest, so the job and every retry build exactly the
 * same file. Creating, retrying, downloading or cancelling a batch never
 * writes settlement entries: an export is not a reimbursement.
 *
 * Lock order: report rows (sorted by id), then batch rows (sorted by id).
 * The job locks only its batch row and finishes only the `attempt` it was
 * started for, so a cancelled or superseded run can never complete.
 *
 * For #614 (reopen) and #615 (adjustments): `loadTravelExpenseReportExportState`
 * says whether a report revision was exported or is in an unfinished batch;
 * `cancelUncompletedTravelExpenseExportsForReport` cancels unfinished batches
 * under the caller's report lock and refuses when one completed.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;
type BatchRow = typeof travelExpenseExportBatch.$inferSelect;

/** Most revisions one batch may contain (the ZIP is assembled in memory). */
export const TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS = 100;
/** A run that has been processing this long may be retried. */
export const TRAVEL_EXPENSE_EXPORT_STALE_MINUTES = 30;

export interface TravelExpenseExportActor {
	organizationId: string;
	employeeId: string;
	userId: string;
}

export interface TravelExpenseExportSelection {
	reportId: string;
	revisionId: string;
}

export type TravelExpenseExportCancelReason = "cancelled_by_finance" | "report_reopened";

export interface TravelExpenseExportBatchReport {
	reportId: string;
	revisionId: string;
	submissionCycle: number;
	employeeName: string | null;
	reportKind: "standalone" | "trip";
	title: string | null;
	currency: string;
	reimbursable: string;
	companyPaid: string;
}

export interface TravelExpenseExportBatchView {
	id: string;
	status: TravelExpenseExportBatchStatus;
	attempt: number;
	revisionCount: number;
	itemCount: number;
	receiptCount: number;
	totals: TravelExpenseExportBatchTotal[];
	manifestDigest: string;
	requestedAt: string;
	requestedByName: string | null;
	startedAt: string | null;
	completedAt: string | null;
	failedAt: string | null;
	errorCode: string | null;
	cancelledAt: string | null;
	cancelReason: string | null;
	fileName: string | null;
	sizeBytes: number | null;
	checksumSha256: string | null;
	/** Failed, or processing for longer than the stale limit. */
	retryable: boolean;
	/** Not yet completed nor cancelled. */
	cancellable: boolean;
	reports: TravelExpenseExportBatchReport[];
}

function instantText(value: Date | null): string | null {
	return value ? instantToCanonicalString(instantFromDate(value)) : null;
}

function isStaleProcessing(row: BatchRow, now: Instant): boolean {
	if (row.status !== "processing" || !row.startedAt) return false;
	const started = instantFromDate(row.startedAt);
	return (
		now.epochMilliseconds - started.epochMilliseconds >=
		TRAVEL_EXPENSE_EXPORT_STALE_MINUTES * 60_000
	);
}

function isRetryable(row: BatchRow, now: Instant): boolean {
	return row.status === "failed" || isStaleProcessing(row, now);
}

function batchReports(manifest: TravelExpenseExportManifest): TravelExpenseExportBatchReport[] {
	return manifest.revisions.map((revision) => ({
		reportId: revision.reportId,
		revisionId: revision.revisionId,
		submissionCycle: revision.submissionCycle,
		employeeName: revision.employeeName,
		reportKind: revision.facts.reportKind,
		title: revision.facts.trip?.purpose ?? revision.facts.items[0]?.description ?? null,
		currency: revision.facts.totals.currency,
		reimbursable: revision.facts.totals.reimbursable,
		companyPaid: revision.facts.totals.companyPaid,
	}));
}

function toView(
	row: BatchRow,
	requestedByName: string | null,
	now: Instant,
): TravelExpenseExportBatchView {
	return {
		id: row.id,
		status: row.status,
		attempt: row.attempt,
		revisionCount: row.revisionCount,
		itemCount: row.itemCount,
		receiptCount: row.receiptCount,
		totals: row.totals,
		manifestDigest: row.manifestDigest,
		requestedAt: instantToCanonicalString(instantFromDate(row.requestedAt)),
		requestedByName,
		startedAt: instantText(row.startedAt),
		completedAt: instantText(row.completedAt),
		failedAt: instantText(row.failedAt),
		errorCode: row.errorCode,
		cancelledAt: instantText(row.cancelledAt),
		cancelReason: row.cancelReason,
		fileName: row.fileName,
		sizeBytes: row.sizeBytes,
		checksumSha256: row.checksumSha256,
		retryable: isRetryable(row, now),
		cancellable: row.status !== "completed" && row.status !== "cancelled",
		reports: batchReports(row.manifest),
	};
}

async function loadBatchView(
	database: Executor,
	organizationId: string,
	batchId: string,
	now: Instant,
): Promise<TravelExpenseExportBatchView | null> {
	const [found] = await database
		.select({ row: travelExpenseExportBatch, requestedByName: user.name })
		.from(travelExpenseExportBatch)
		.leftJoin(user, eq(user.id, travelExpenseExportBatch.requestedByUserId))
		.where(
			and(
				eq(travelExpenseExportBatch.id, batchId),
				eq(travelExpenseExportBatch.organizationId, organizationId),
			),
		)
		.limit(1);
	return found ? toView(found.row, found.requestedByName, now) : null;
}

async function lockBatch(
	tx: Transaction,
	organizationId: string,
	batchId: string,
): Promise<BatchRow | null> {
	const [row] = await tx
		.select()
		.from(travelExpenseExportBatch)
		.where(
			and(
				eq(travelExpenseExportBatch.id, batchId),
				eq(travelExpenseExportBatch.organizationId, organizationId),
			),
		)
		.limit(1)
		.for("update");
	return row ?? null;
}

function batchTotals(
	revisions: readonly TravelExpenseExportManifestRevision[],
): TravelExpenseExportBatchTotal[] {
	const byCurrency = new Map<string, { reimbursable: bigint[]; companyPaid: bigint[] }>();
	for (const { facts } of revisions) {
		const line = byCurrency.get(facts.totals.currency) ?? { reimbursable: [], companyPaid: [] };
		line.reimbursable.push(parseUnits(facts.totals.reimbursable, STORED_AMOUNT_SCALE) ?? BigInt(0));
		line.companyPaid.push(parseUnits(facts.totals.companyPaid, STORED_AMOUNT_SCALE) ?? BigInt(0));
		byCurrency.set(facts.totals.currency, line);
	}
	return [...byCurrency.entries()]
		.toSorted(([left], [right]) => (left < right ? -1 : 1))
		.map(([currency, line]) => ({
			currency,
			reimbursable: formatUnits(sumUnits(line.reimbursable), STORED_AMOUNT_SCALE),
			companyPaid: formatUnits(sumUnits(line.companyPaid), STORED_AMOUNT_SCALE),
		}));
}

export type CreateTravelExpenseExportBatchResult =
	| { status: "created"; replayed: boolean; batch: TravelExpenseExportBatchView }
	/** Empty, too large or with duplicate reports. */
	| { status: "invalid_selection" }
	/** The key was used for another selection. */
	| { status: "idempotency_conflict" }
	/** Not found, no longer approved, or not the approved current revision. */
	| { status: "stale_selection"; reportIds: string[] }
	/** Already part of a batch that is not cancelled. */
	| { status: "already_exported"; reportIds: string[] };

async function findBatchByKey(tx: Transaction, organizationId: string, key: string) {
	const [row] = await tx
		.select({
			id: travelExpenseExportBatch.id,
			fingerprint: travelExpenseExportBatch.selectionFingerprint,
		})
		.from(travelExpenseExportBatch)
		.where(
			and(
				eq(travelExpenseExportBatch.organizationId, organizationId),
				eq(travelExpenseExportBatch.idempotencyKey, key),
			),
		)
		.limit(1);
	return row ?? null;
}

/**
 * Creates one queued batch for the selected approved revisions. A retried
 * request with the same idempotency key returns the batch it created. The
 * caller enqueues the job after commit (`enqueueTravelExpenseExportBatch`).
 */
export async function createTravelExpenseExportBatch(
	database: Database,
	input: {
		actor: TravelExpenseExportActor;
		idempotencyKey: string;
		selection: readonly TravelExpenseExportSelection[];
	},
	now: Instant = systemClock.nowInstant(),
): Promise<CreateTravelExpenseExportBatchResult> {
	const { actor, selection } = input;
	const reportIds = selection.map((entry) => entry.reportId);
	if (
		selection.length === 0 ||
		selection.length > TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS ||
		new Set(reportIds).size !== reportIds.length
	) {
		return { status: "invalid_selection" };
	}
	const fingerprint = travelExpenseExportSelectionFingerprint(selection);
	return database.transaction(async (tx) => {
		const existing = await findBatchByKey(tx, actor.organizationId, input.idempotencyKey);
		if (existing) {
			if (existing.fingerprint !== fingerprint) return { status: "idempotency_conflict" } as const;
			const batch = await loadBatchView(tx, actor.organizationId, existing.id, now);
			if (!batch) throw new Error("Export batch vanished");
			return { status: "created", replayed: true, batch } as const;
		}

		// The settlement account lock: approval cannot change underneath us, and
		// #614 reopening the report waits for this batch (or sees it).
		const stale: string[] = [];
		const revisions: TravelExpenseExportManifestRevision[] = [];
		for (const entry of selection.toSorted((left, right) =>
			left.reportId < right.reportId ? -1 : 1,
		)) {
			const account = await loadSettlementAccount(
				tx,
				{ organizationId: actor.organizationId, source: { type: "report", id: entry.reportId } },
				{ lock: true },
			);
			const basis = account?.approved ? account.basis : null;
			if (
				!account ||
				!basis?.revisionId ||
				!basis.approvedAt ||
				basis.submissionCycle === null ||
				basis.revisionId !== entry.revisionId
			) {
				stale.push(entry.reportId);
				continue;
			}
			const revision = await loadTravelExpenseReportSubmittedRevision(tx, {
				organizationId: actor.organizationId,
				reportId: entry.reportId,
				submissionCycle: basis.submissionCycle,
			});
			if (!revision || revision.id !== entry.revisionId) {
				stale.push(entry.reportId);
				continue;
			}
			revisions.push({
				reportId: revision.reportId,
				revisionId: revision.id,
				submissionCycle: revision.submissionCycle,
				materialFingerprint: revision.materialFingerprint,
				approvedAt: basis.approvedAt,
				employeeId: account.employeeId,
				employeeName: account.employeeName,
				facts: revision.facts,
				receiptFileNames: revision.labels.receiptFileNames,
			});
		}
		if (stale.length > 0) return { status: "stale_selection", reportIds: stale } as const;

		const claimed = await tx
			.select({ reportId: travelExpenseExportBatchRevision.reportId })
			.from(travelExpenseExportBatchRevision)
			.where(
				and(
					eq(travelExpenseExportBatchRevision.organizationId, actor.organizationId),
					inArray(
						travelExpenseExportBatchRevision.submittedRevisionId,
						selection.map((entry) => entry.revisionId),
					),
					isNull(travelExpenseExportBatchRevision.releasedAt),
				),
			);
		if (claimed.length > 0) {
			return {
				status: "already_exported",
				reportIds: [...new Set(claimed.map((row) => row.reportId))].toSorted(),
			} as const;
		}

		const batchId = randomUUID();
		const manifest: TravelExpenseExportManifest = {
			kind: "travel_expense_export",
			version: TRAVEL_EXPENSE_EXPORT_MANIFEST_VERSION,
			organizationId: actor.organizationId,
			batchId,
			createdAt: instantToCanonicalString(now),
			revisions: sortManifestRevisions(revisions),
		};
		const inserted = await tx
			.insert(travelExpenseExportBatch)
			.values({
				id: batchId,
				organizationId: actor.organizationId,
				status: "queued",
				idempotencyKey: input.idempotencyKey,
				selectionFingerprint: fingerprint,
				manifestVersion: manifest.version,
				manifest,
				manifestDigest: travelExpenseExportManifestDigest(manifest),
				revisionCount: revisions.length,
				itemCount: revisions.reduce((count, { facts }) => count + facts.items.length, 0),
				receiptCount: revisions.reduce(
					(count, { facts }) =>
						count + facts.items.reduce((sum, item) => sum + item.receipts.length, 0),
					0,
				),
				totals: batchTotals(revisions),
				attempt: 1,
				requestedByEmployeeId: actor.employeeId,
				requestedByUserId: actor.userId,
				requestedAt: dateFromInstant(now),
			})
			.onConflictDoNothing({
				target: [travelExpenseExportBatch.organizationId, travelExpenseExportBatch.idempotencyKey],
			})
			.returning({ id: travelExpenseExportBatch.id });
		if (inserted.length === 0) {
			// The same key committed concurrently (for other reports).
			const raced = await findBatchByKey(tx, actor.organizationId, input.idempotencyKey);
			if (!raced || raced.fingerprint !== fingerprint) {
				return { status: "idempotency_conflict" } as const;
			}
			const batch = await loadBatchView(tx, actor.organizationId, raced.id, now);
			if (!batch) throw new Error("Export batch vanished");
			return { status: "created", replayed: true, batch } as const;
		}
		await tx.insert(travelExpenseExportBatchRevision).values(
			revisions.map((revision) => ({
				batchId,
				organizationId: actor.organizationId,
				reportId: revision.reportId,
				submittedRevisionId: revision.revisionId,
				submissionCycle: revision.submissionCycle,
			})),
		);
		const batch = await loadBatchView(tx, actor.organizationId, batchId, now);
		if (!batch) throw new Error("Created export batch not readable");
		return { status: "created", replayed: false, batch } as const;
	});
}

/** The organization's batches, newest first. */
export async function listTravelExpenseExportBatches(
	database: Executor,
	input: { organizationId: string; limit?: number },
	now: Instant = systemClock.nowInstant(),
): Promise<TravelExpenseExportBatchView[]> {
	const rows = await database
		.select({ row: travelExpenseExportBatch, requestedByName: user.name })
		.from(travelExpenseExportBatch)
		.leftJoin(user, eq(user.id, travelExpenseExportBatch.requestedByUserId))
		.where(eq(travelExpenseExportBatch.organizationId, input.organizationId))
		.orderBy(desc(travelExpenseExportBatch.requestedAt), desc(travelExpenseExportBatch.id))
		.limit(input.limit ?? 25);
	return rows.map(({ row, requestedByName }) => toView(row, requestedByName, now));
}

export interface ExportableTravelExpenseRevision {
	reportId: string;
	revisionId: string;
	submissionCycle: number;
	account: SettlementAccount;
}

/**
 * Approved report revisions not yet part of a batch that is not cancelled.
 * Legacy claims have no frozen revision and are not exported.
 */
export async function listExportableTravelExpenseRevisions(
	database: Executor,
	input: { organizationId: string },
): Promise<ExportableTravelExpenseRevision[]> {
	const accounts = await listFinanceQueue(database, {
		organizationId: input.organizationId,
		filter: "all",
		// Approved adjustments (#615) are exported as their own revisions.
		includeAdjustments: true,
	});
	const candidates = accounts.filter(
		(account) =>
			account.source.type === "report" &&
			account.basis?.revisionId &&
			account.basis.submissionCycle !== null,
	);
	if (candidates.length === 0) return [];
	const claimed = await database
		.select({ revisionId: travelExpenseExportBatchRevision.submittedRevisionId })
		.from(travelExpenseExportBatchRevision)
		.where(
			and(
				eq(travelExpenseExportBatchRevision.organizationId, input.organizationId),
				inArray(
					travelExpenseExportBatchRevision.reportId,
					candidates.map((account) => account.source.id),
				),
				isNull(travelExpenseExportBatchRevision.releasedAt),
			),
		);
	const claimedIds = new Set(claimed.map((row) => row.revisionId));
	return candidates
		.filter((account) => !claimedIds.has(account.basis?.revisionId ?? ""))
		.map((account) => ({
			reportId: account.source.id,
			revisionId: account.basis?.revisionId ?? "",
			submissionCycle: account.basis?.submissionCycle ?? 0,
			account,
		}));
}

export type RetryTravelExpenseExportBatchResult =
	| { status: "queued"; batch: TravelExpenseExportBatchView }
	/** Already queued, still processing, completed or cancelled: nothing changed. */
	| { status: "not_retryable"; batch: TravelExpenseExportBatchView }
	| { status: "not_found" };

/**
 * Re-queues a failed (or stale processing) batch as its next attempt. The
 * batch, its manifest and its revisions stay the same; a double retry finds
 * the batch already queued and changes nothing.
 */
export async function retryTravelExpenseExportBatch(
	database: Database,
	input: { organizationId: string; batchId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<RetryTravelExpenseExportBatchResult> {
	return database.transaction(async (tx) => {
		const row = await lockBatch(tx, input.organizationId, input.batchId);
		if (!row) return { status: "not_found" } as const;
		if (isRetryable(row, now)) {
			await tx
				.update(travelExpenseExportBatch)
				.set({
					status: "queued",
					attempt: row.attempt + 1,
					startedAt: null,
					failedAt: null,
					errorCode: null,
					errorMessage: null,
				})
				.where(eq(travelExpenseExportBatch.id, row.id));
		}
		const batch = await loadBatchView(tx, input.organizationId, row.id, now);
		if (!batch) throw new Error("Export batch vanished");
		return isRetryable(row, now)
			? ({ status: "queued", batch } as const)
			: ({ status: "not_retryable", batch } as const);
	});
}

async function cancelLockedBatch(
	tx: Transaction,
	row: BatchRow,
	input: { reason: TravelExpenseExportCancelReason; cancelledByUserId: string | null },
	now: Instant,
): Promise<void> {
	const at = dateFromInstant(now);
	await tx
		.update(travelExpenseExportBatch)
		.set({
			status: "cancelled",
			cancelledAt: at,
			cancelReason: input.reason,
			cancelledByUserId: input.cancelledByUserId,
		})
		.where(eq(travelExpenseExportBatch.id, row.id));
	await tx
		.update(travelExpenseExportBatchRevision)
		.set({ releasedAt: at })
		.where(
			and(
				eq(travelExpenseExportBatchRevision.batchId, row.id),
				eq(travelExpenseExportBatchRevision.organizationId, row.organizationId),
				isNull(travelExpenseExportBatchRevision.releasedAt),
			),
		);
}

export type CancelTravelExpenseExportBatchResult =
	| { status: "cancelled"; replayed: boolean; batch: TravelExpenseExportBatchView }
	/** A completed batch is history and cannot be cancelled. */
	| { status: "completed"; batch: TravelExpenseExportBatchView }
	| { status: "not_found" };

/**
 * Cancels a batch that has not completed and releases its revisions, so they
 * can be exported again. A running job's result is discarded.
 */
export async function cancelTravelExpenseExportBatch(
	database: Database,
	input: {
		organizationId: string;
		batchId: string;
		reason: TravelExpenseExportCancelReason;
		cancelledByUserId: string | null;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<CancelTravelExpenseExportBatchResult> {
	return database.transaction(async (tx) => {
		const row = await lockBatch(tx, input.organizationId, input.batchId);
		if (!row) return { status: "not_found" } as const;
		const replayed = row.status === "cancelled";
		if (row.status !== "completed" && !replayed) await cancelLockedBatch(tx, row, input, now);
		const batch = await loadBatchView(tx, input.organizationId, row.id, now);
		if (!batch) throw new Error("Export batch vanished");
		return row.status === "completed"
			? ({ status: "completed", batch } as const)
			: ({ status: "cancelled", replayed, batch } as const);
	});
}

export interface TravelExpenseReportExportState {
	/** A completed batch exported a revision of the report (or the named revision). */
	exported: boolean;
	/** A queued, processing or failed batch holds one. */
	pending: boolean;
	batches: Array<{
		batchId: string;
		status: TravelExpenseExportBatchStatus;
		revisionId: string;
		submissionCycle: number;
	}>;
}

/**
 * Export state of a report (#614/#615): every batch that is not cancelled and
 * holds one of its revisions (or only `revisionId`). Read-only; under the
 * report lock the answer cannot change except by a job completing a pending
 * batch, which `cancelUncompletedTravelExpenseExportsForReport` serializes.
 */
export async function loadTravelExpenseReportExportState(
	database: Executor,
	input: { organizationId: string; reportId: string; revisionId?: string },
): Promise<TravelExpenseReportExportState> {
	const rows = await database
		.select({
			batchId: travelExpenseExportBatch.id,
			status: travelExpenseExportBatch.status,
			revisionId: travelExpenseExportBatchRevision.submittedRevisionId,
			submissionCycle: travelExpenseExportBatchRevision.submissionCycle,
		})
		.from(travelExpenseExportBatchRevision)
		.innerJoin(
			travelExpenseExportBatch,
			and(
				eq(travelExpenseExportBatch.id, travelExpenseExportBatchRevision.batchId),
				eq(
					travelExpenseExportBatch.organizationId,
					travelExpenseExportBatchRevision.organizationId,
				),
			),
		)
		.where(
			and(
				eq(travelExpenseExportBatchRevision.organizationId, input.organizationId),
				eq(travelExpenseExportBatchRevision.reportId, input.reportId),
				isNull(travelExpenseExportBatchRevision.releasedAt),
				...(input.revisionId
					? [eq(travelExpenseExportBatchRevision.submittedRevisionId, input.revisionId)]
					: []),
			),
		)
		.orderBy(asc(travelExpenseExportBatch.requestedAt));
	const batches = rows.filter((row) => row.status !== "cancelled");
	return {
		exported: batches.some((row) => row.status === "completed"),
		pending: batches.some((row) => row.status !== "completed"),
		batches,
	};
}

export type CancelReportExportsResult =
	| { status: "cleared"; cancelledBatchIds: string[] }
	/** A completed batch exported the report: reopening must become an adjustment (#615). */
	| { status: "exported"; batchIds: string[] };

/**
 * For #614: call inside the reopening transaction AFTER locking the report
 * (`loadSettlementAccount(tx, …, {lock: true})`). Locks every unfinished batch
 * holding one of the report's revisions; if any batch completed it refuses
 * without changing anything, otherwise it cancels them all (releasing every
 * revision they hold, also of other reports). A job finishing concurrently
 * either completed first (refused here) or finds its batch cancelled.
 */
export async function cancelUncompletedTravelExpenseExportsForReport(
	tx: Transaction,
	input: { organizationId: string; reportId: string; cancelledByUserId: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<CancelReportExportsResult> {
	const held = await tx
		.select({ batchId: travelExpenseExportBatchRevision.batchId })
		.from(travelExpenseExportBatchRevision)
		.where(
			and(
				eq(travelExpenseExportBatchRevision.organizationId, input.organizationId),
				eq(travelExpenseExportBatchRevision.reportId, input.reportId),
				isNull(travelExpenseExportBatchRevision.releasedAt),
			),
		);
	const batchIds = [...new Set(held.map((row) => row.batchId))].toSorted();
	const locked: BatchRow[] = [];
	for (const batchId of batchIds) {
		const row = await lockBatch(tx, input.organizationId, batchId);
		if (row && row.status !== "cancelled") locked.push(row);
	}
	const completed = locked.filter((row) => row.status === "completed");
	if (completed.length > 0) {
		return { status: "exported", batchIds: completed.map((row) => row.id) };
	}
	for (const row of locked) {
		await cancelLockedBatch(
			tx,
			row,
			{ reason: "report_reopened", cancelledByUserId: input.cancelledByUserId },
			now,
		);
	}
	return { status: "cleared", cancelledBatchIds: locked.map((row) => row.id) };
}

// ---------------------------------------------------------------------------
// Job steps (export-processor.ts)
// ---------------------------------------------------------------------------

export type ClaimTravelExpenseExportResult =
	| { status: "claimed"; manifest: TravelExpenseExportManifest; manifestDigest: string }
	| { status: "skipped" };

/** Moves the queued `attempt` to processing; any other state skips the run. */
export async function claimTravelExpenseExportAttempt(
	database: Database,
	input: { organizationId: string; batchId: string; attempt: number },
	now: Instant = systemClock.nowInstant(),
): Promise<ClaimTravelExpenseExportResult> {
	return database.transaction(async (tx) => {
		const row = await lockBatch(tx, input.organizationId, input.batchId);
		if (!row || row.status !== "queued" || row.attempt !== input.attempt) {
			return { status: "skipped" } as const;
		}
		await tx
			.update(travelExpenseExportBatch)
			.set({ status: "processing", startedAt: dateFromInstant(now) })
			.where(eq(travelExpenseExportBatch.id, row.id));
		return {
			status: "claimed",
			manifest: row.manifest,
			manifestDigest: row.manifestDigest,
		} as const;
	});
}

/** Completes the running attempt; false when it was cancelled or superseded. */
export async function completeTravelExpenseExportAttempt(
	database: Database,
	input: {
		organizationId: string;
		batchId: string;
		attempt: number;
		file: {
			fileName: string;
			bucket: string | null;
			key: string;
			versionId: string | null;
			sizeBytes: number;
			checksumSha256: string;
		};
	},
	now: Instant = systemClock.nowInstant(),
): Promise<boolean> {
	return database.transaction(async (tx) => {
		const row = await lockBatch(tx, input.organizationId, input.batchId);
		if (!row || row.status !== "processing" || row.attempt !== input.attempt) return false;
		await tx
			.update(travelExpenseExportBatch)
			.set({
				status: "completed",
				completedAt: dateFromInstant(now),
				fileName: input.file.fileName,
				storageBucket: input.file.bucket,
				storageKey: input.file.key,
				storageVersionId: input.file.versionId,
				sizeBytes: input.file.sizeBytes,
				checksumSha256: input.file.checksumSha256,
			})
			.where(eq(travelExpenseExportBatch.id, row.id));
		return true;
	});
}

/** Records a failed attempt (queued or processing); false when it was superseded. */
export async function failTravelExpenseExportAttempt(
	database: Database,
	input: {
		organizationId: string;
		batchId: string;
		attempt: number;
		errorCode: string;
		errorMessage: string;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<boolean> {
	return database.transaction(async (tx) => {
		const row = await lockBatch(tx, input.organizationId, input.batchId);
		if (
			!row ||
			(row.status !== "processing" && row.status !== "queued") ||
			row.attempt !== input.attempt
		) {
			return false;
		}
		await tx
			.update(travelExpenseExportBatch)
			.set({
				status: "failed",
				failedAt: dateFromInstant(now),
				errorCode: input.errorCode,
				errorMessage: input.errorMessage.slice(0, 500),
			})
			.where(eq(travelExpenseExportBatch.id, row.id));
		return true;
	});
}

/** The stored file of a completed batch, for a permission-checked download. */
export async function loadCompletedTravelExpenseExportFile(
	database: Executor,
	input: { organizationId: string; batchId: string },
): Promise<{
	fileName: string;
	bucket: string | null;
	key: string;
	versionId: string | null;
	sizeBytes: number;
	checksumSha256: string;
	revisionCount: number;
} | null> {
	const [row] = await database
		.select()
		.from(travelExpenseExportBatch)
		.where(
			and(
				eq(travelExpenseExportBatch.id, input.batchId),
				eq(travelExpenseExportBatch.organizationId, input.organizationId),
				eq(travelExpenseExportBatch.status, "completed"),
			),
		)
		.limit(1);
	if (!row?.storageKey || !row.fileName || row.sizeBytes === null || !row.checksumSha256) {
		return null;
	}
	return {
		fileName: row.fileName,
		bucket: row.storageBucket,
		key: row.storageKey,
		versionId: row.storageVersionId,
		sizeBytes: row.sizeBytes,
		checksumSha256: row.checksumSha256,
		revisionCount: row.revisionCount,
	};
}
