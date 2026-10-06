import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type TravelExpenseReportItemType,
	type TravelExpenseReportKind,
	type TravelExpenseReportStatus,
	travelExpenseReceiptUpload,
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportReceipt,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	DEFAULT_REIMBURSEMENT_CURRENCY,
	type ReceiptItemDraft,
	receiptReportTotals,
} from "./receipt-report";
import { EDITABLE_REPORT_STATUSES, isEditableReportStatus } from "./report-return";
import type { TripDetailsDraft } from "./trip-report";

/**
 * Draft travel expense reports (#600). Every read and write is scoped to the
 * owning employee in their organization. Writes take the report row lock, the
 * same lock receipt finalization (and later submission) takes, and item saves
 * are versioned so a stale save never overwrites a newer edit.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ReportOwner {
	organizationId: string;
	employeeId: string;
	userId: string;
}

export interface ReportReceiptView {
	id: string;
	fileName: string;
	mimeType: string;
	sizeBytes: number;
	createdAt: string;
}

/** Columns of a receipt's view; select them and map rows with `toReceiptView`. */
export const receiptViewColumns = {
	id: travelExpenseReportReceipt.id,
	fileName: travelExpenseReportReceipt.fileName,
	mimeType: travelExpenseReportReceipt.mimeType,
	sizeBytes: travelExpenseReportReceipt.sizeBytes,
	createdAt: travelExpenseReportReceipt.createdAt,
};

export function toReceiptView(row: Omit<ReportReceiptView, "createdAt"> & { createdAt: Date }) {
	return {
		id: row.id,
		fileName: row.fileName,
		mimeType: row.mimeType,
		sizeBytes: row.sizeBytes,
		createdAt: row.createdAt.toISOString(),
	} satisfies ReportReceiptView;
}

export interface ReportItemView extends ReceiptItemDraft {
	id: string;
	type: TravelExpenseReportItemType;
	version: number;
	updatedAt: string;
	receipts: ReportReceiptView[];
}

/** Shared travel details of a trip report and the version they were saved at. */
export interface TripDetailsView extends TripDetailsDraft {
	version: number;
}

export interface ReportView {
	id: string;
	kind: TravelExpenseReportKind;
	status: TravelExpenseReportStatus;
	/** Submission cycles so far; a withdrawn or returned report has history (#603). */
	submissionCount: number;
	reimbursementCurrency: string;
	createdAt: string;
	updatedAt: string;
	/** Null for standalone reports, which have no trip. */
	trip: TripDetailsView | null;
	items: ReportItemView[];
}

type ReportRow = typeof travelExpenseReport.$inferSelect;

function toTripDetailsView(row: ReportRow): TripDetailsView | null {
	if (row.kind !== "trip" || !row.tripTimeZone) return null;
	return {
		version: row.detailsVersion,
		purpose: row.tripPurpose,
		startDate: row.tripStartDate,
		endDate: row.tripEndDate,
		timeZone: row.tripTimeZone,
		destinations: row.tripDestinations,
	};
}

export async function createStandaloneReceiptReport(
	database: Database,
	owner: ReportOwner,
	now: Instant = systemClock.nowInstant(),
): Promise<{ reportId: string; itemId: string }> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const [report] = await tx
			.insert(travelExpenseReport)
			.values({
				organizationId: owner.organizationId,
				employeeId: owner.employeeId,
				kind: "standalone",
				status: "draft",
				reimbursementCurrency: DEFAULT_REIMBURSEMENT_CURRENCY,
				createdAt: at,
				createdBy: owner.userId,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.returning({ id: travelExpenseReport.id });
		if (!report) throw new Error("Failed to create travel expense report");
		const [item] = await tx
			.insert(travelExpenseReportItem)
			.values({
				organizationId: owner.organizationId,
				reportId: report.id,
				type: "receipt",
				position: 0,
				// Same-currency receipts are the supported case; the employee can change it.
				originalCurrency: DEFAULT_REIMBURSEMENT_CURRENCY,
				createdAt: at,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.returning({ id: travelExpenseReportItem.id });
		if (!item) throw new Error("Failed to create travel expense report item");
		return { reportId: report.id, itemId: item.id };
	});
}

/**
 * Creates an empty trip report. Its travel dates are calendar days in
 * `timeZone`, the employee's effective zone unless they change it.
 */
export async function createTripReport(
	database: Database,
	owner: ReportOwner,
	input: { timeZone: string },
	now: Instant = systemClock.nowInstant(),
): Promise<{ reportId: string }> {
	const at = dateFromInstant(now);
	const [report] = await database
		.insert(travelExpenseReport)
		.values({
			organizationId: owner.organizationId,
			employeeId: owner.employeeId,
			kind: "trip",
			status: "draft",
			reimbursementCurrency: DEFAULT_REIMBURSEMENT_CURRENCY,
			tripTimeZone: input.timeZone,
			createdAt: at,
			createdBy: owner.userId,
			updatedAt: at,
			updatedBy: owner.userId,
		})
		.returning({ id: travelExpenseReport.id });
	if (!report) throw new Error("Failed to create travel expense report");
	return { reportId: report.id };
}

type ReportScope = Pick<ReportOwner, "organizationId" | "employeeId">;

/** Bumps the report's last-edited time, e.g. for the drafts list. */
export async function touchReport(tx: Transaction, owner: ReportOwner, reportId: string, at: Date) {
	await tx
		.update(travelExpenseReport)
		.set({ updatedAt: at, updatedBy: owner.userId })
		.where(ownedReport(owner, reportId));
}

function ownedReport(owner: ReportScope, reportId: string) {
	return and(
		eq(travelExpenseReport.id, reportId),
		eq(travelExpenseReport.organizationId, owner.organizationId),
		eq(travelExpenseReport.employeeId, owner.employeeId),
	);
}

/** Locks the owner's report row; null when it is not theirs or not a draft. */
export async function lockOwnDraftReport(
	tx: Transaction,
	owner: ReportScope,
	reportId: string,
): Promise<
	| { status: "draft"; kind: TravelExpenseReportKind }
	| { status: "not_found" }
	| { status: "not_draft" }
> {
	const [report] = await tx
		.select({ status: travelExpenseReport.status, kind: travelExpenseReport.kind })
		.from(travelExpenseReport)
		.where(ownedReport(owner, reportId))
		.for("update");
	if (!report) return { status: "not_found" };
	// A returned report (#603) is edited like a draft; the result keeps its tag.
	return isEditableReportStatus(report.status)
		? { status: "draft", kind: report.kind }
		: { status: "not_draft" };
}

/** Locks the owner's draft trip report; standalone reports have no trip to edit. */
async function lockOwnDraftTrip(
	tx: Transaction,
	owner: ReportScope,
	reportId: string,
): Promise<{ kind: "draft" } | { kind: "not_found" } | { kind: "not_draft" }> {
	const report = await lockOwnDraftReport(tx, owner, reportId);
	if (report.status !== "draft") return { kind: report.status };
	return report.kind === "trip" ? { kind: "draft" } : { kind: "not_found" };
}

/** Unlocked pre-check: whether the item belongs to the owner's draft report. */
export async function isOwnDraftReportItem(
	database: Database,
	owner: ReportScope,
	input: { reportId: string; itemId: string },
): Promise<boolean> {
	const [row] = await database
		.select({ id: travelExpenseReportItem.id })
		.from(travelExpenseReportItem)
		.innerJoin(
			travelExpenseReport,
			and(
				eq(travelExpenseReport.id, travelExpenseReportItem.reportId),
				eq(travelExpenseReport.organizationId, travelExpenseReportItem.organizationId),
			),
		)
		.where(
			and(
				ownedReport(owner, input.reportId),
				inArray(travelExpenseReport.status, [...EDITABLE_REPORT_STATUSES]),
				eq(travelExpenseReportItem.id, input.itemId),
			),
		)
		.limit(1);
	return Boolean(row);
}

type ItemRow = typeof travelExpenseReportItem.$inferSelect;

function toItemView(row: ItemRow, receipts: ReportReceiptView[]): ReportItemView {
	return {
		id: row.id,
		type: row.type,
		version: row.version,
		updatedAt: row.updatedAt.toISOString(),
		expenseDate: row.expenseDate,
		category: row.category,
		description: row.description,
		amount: row.originalAmount,
		currency: row.originalCurrency,
		paidBy: row.paidBy,
		accountingReference: row.accountingReference,
		receipts,
	};
}

export async function loadOwnReport(
	database: Database,
	owner: ReportOwner,
	reportId: string,
): Promise<ReportView | null> {
	const [report] = await database
		.select()
		.from(travelExpenseReport)
		.where(ownedReport(owner, reportId))
		.limit(1);
	if (!report) return null;
	const [items, receipts] = await Promise.all([
		database
			.select()
			.from(travelExpenseReportItem)
			.where(
				and(
					eq(travelExpenseReportItem.reportId, report.id),
					eq(travelExpenseReportItem.organizationId, owner.organizationId),
				),
			)
			.orderBy(asc(travelExpenseReportItem.position)),
		database
			.select({ ...receiptViewColumns, itemId: travelExpenseReportReceipt.itemId })
			.from(travelExpenseReportReceipt)
			.where(
				and(
					eq(travelExpenseReportReceipt.reportId, report.id),
					eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
				),
			)
			.orderBy(asc(travelExpenseReportReceipt.createdAt), asc(travelExpenseReportReceipt.id)),
	]);
	return {
		id: report.id,
		kind: report.kind,
		status: report.status,
		submissionCount: report.submissionCount,
		reimbursementCurrency: report.reimbursementCurrency,
		createdAt: report.createdAt.toISOString(),
		updatedAt: report.updatedAt.toISOString(),
		trip: toTripDetailsView(report),
		items: items.map((item) =>
			toItemView(item, receipts.filter((receipt) => receipt.itemId === item.id).map(toReceiptView)),
		),
	};
}

export interface DraftReportSummary {
	id: string;
	kind: TravelExpenseReportKind;
	status: TravelExpenseReportStatus;
	updatedAt: string;
	/** The (first) expense's facts; a trip's first expense is not its title. */
	expenseDate: string | null;
	description: string | null;
	amount: string | null;
	currency: string | null;
	receiptCount: number;
	/** Null for standalone reports. */
	trip: DraftTripSummary | null;
}

export interface DraftTripSummary {
	purpose: string | null;
	startDate: string | null;
	endDate: string | null;
	itemCount: number;
	/** Employee-paid total of the countable expenses. */
	reimbursable: string;
	currency: string;
}

/** The owner's draft reports, most recently edited first, for resuming them. */
export function listOwnDraftReports(
	database: Database,
	owner: ReportOwner,
): Promise<DraftReportSummary[]> {
	return listOwnReports(database, owner, ["draft"]);
}

/** The owner's submitted and decided reports (#602), most recently changed first. */
export function listOwnSubmittedReports(
	database: Database,
	owner: ReportOwner,
): Promise<DraftReportSummary[]> {
	return listOwnReports(database, owner, ["submitted", "approved", "rejected", "returned"]);
}

async function listOwnReports(
	database: Database,
	owner: ReportOwner,
	statuses: TravelExpenseReportStatus[],
): Promise<DraftReportSummary[]> {
	const reports = await database
		.select()
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
				inArray(travelExpenseReport.status, statuses),
			),
		)
		.orderBy(desc(travelExpenseReport.updatedAt), desc(travelExpenseReport.id));
	if (reports.length === 0) return [];
	const reportIds = reports.map((report) => report.id);
	const [items, receiptCounts] = await Promise.all([
		database
			.select()
			.from(travelExpenseReportItem)
			.where(
				and(
					eq(travelExpenseReportItem.organizationId, owner.organizationId),
					inArray(travelExpenseReportItem.reportId, reportIds),
				),
			)
			.orderBy(asc(travelExpenseReportItem.position)),
		database
			.select({
				reportId: travelExpenseReportReceipt.reportId,
				count: sql<number>`count(*)::int`,
			})
			.from(travelExpenseReportReceipt)
			.where(
				and(
					eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
					inArray(travelExpenseReportReceipt.reportId, reportIds),
				),
			)
			.groupBy(travelExpenseReportReceipt.reportId),
	]);
	return reports.map((report) => {
		const reportItems = items.filter((candidate) => candidate.reportId === report.id);
		const item = reportItems[0];
		return {
			id: report.id,
			kind: report.kind,
			status: report.status,
			updatedAt: report.updatedAt.toISOString(),
			expenseDate: item?.expenseDate ?? null,
			description: item?.description ?? null,
			amount: item?.originalAmount ?? null,
			currency: item?.originalCurrency ?? null,
			receiptCount: receiptCounts.find((row) => row.reportId === report.id)?.count ?? 0,
			trip: report.kind === "trip" ? tripDraftSummary(report, reportItems) : null,
		};
	});
}

function tripDraftSummary(report: ReportRow, items: ItemRow[]): DraftTripSummary {
	const totals = receiptReportTotals(
		items.map((row) => ({
			amount: row.originalAmount,
			currency: row.originalCurrency,
			paidBy: row.paidBy,
		})),
		report.reimbursementCurrency,
	);
	return {
		purpose: report.tripPurpose,
		startDate: report.tripStartDate,
		endDate: report.tripEndDate,
		itemCount: items.length,
		reimbursable: totals.reimbursable,
		currency: totals.currency,
	};
}

export type SaveReceiptItemResult =
	| { kind: "saved"; item: ReportItemView }
	/** The item changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; item: ReportItemView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Saves the complete draft facts of one receipt item, but only on top of the
 * version the editor last saw. The report row lock serializes it with receipt
 * finalization and submission.
 */
export async function saveReceiptItemDraft(
	database: Database,
	owner: ReportOwner,
	input: {
		reportId: string;
		itemId: string;
		expectedVersion: number;
		draft: ReceiptItemDraft;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<SaveReceiptItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		const item = and(
			eq(travelExpenseReportItem.id, input.itemId),
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
		);
		const [saved] = await tx
			.update(travelExpenseReportItem)
			.set({
				expenseDate: input.draft.expenseDate,
				category: input.draft.category,
				description: input.draft.description,
				originalAmount: input.draft.amount,
				originalCurrency: input.draft.currency,
				paidBy: input.draft.paidBy,
				accountingReference: input.draft.accountingReference,
				version: sql`${travelExpenseReportItem.version} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(and(item, eq(travelExpenseReportItem.version, input.expectedVersion)))
			.returning();
		const receipts = await itemReceipts(tx, owner, input.itemId);
		if (saved) {
			await touchReport(tx, owner, input.reportId, at);
			return { kind: "saved", item: toItemView(saved, receipts) };
		}
		const [current] = await tx.select().from(travelExpenseReportItem).where(item);
		return current
			? { kind: "conflict", item: toItemView(current, receipts) }
			: { kind: "not_found" };
	});
}

export type SaveTripDetailsResult =
	| { kind: "saved"; details: TripDetailsView }
	/** The details changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; details: TripDetailsView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Saves the complete shared travel details of a draft trip, but only on top
 * of the version the editor last saw, like an item save.
 */
export async function saveTripDetailsDraft(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; expectedVersion: number; details: TripDetailsDraft },
	now: Instant = systemClock.nowInstant(),
): Promise<SaveTripDetailsResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const trip = await lockOwnDraftTrip(tx, owner, input.reportId);
		if (trip.kind !== "draft") return trip;
		const [saved] = await tx
			.update(travelExpenseReport)
			.set({
				tripPurpose: input.details.purpose,
				tripStartDate: input.details.startDate,
				tripEndDate: input.details.endDate,
				tripTimeZone: input.details.timeZone,
				tripDestinations: input.details.destinations,
				detailsVersion: sql`${travelExpenseReport.detailsVersion} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(
				and(
					ownedReport(owner, input.reportId),
					eq(travelExpenseReport.detailsVersion, input.expectedVersion),
				),
			)
			.returning();
		const details = saved
			? toTripDetailsView(saved)
			: await tx
					.select()
					.from(travelExpenseReport)
					.where(ownedReport(owner, input.reportId))
					.then(([current]) => (current ? toTripDetailsView(current) : null));
		if (!details) return { kind: "not_found" };
		return { kind: saved ? "saved" : "conflict", details };
	});
}

export type AddTripReportItemResult =
	| { kind: "added"; item: ReportItemView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/** Appends an empty receipt expense to a draft trip, after its last expense. */
export async function addTripReportItem(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<AddTripReportItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const trip = await lockOwnDraftTrip(tx, owner, input.reportId);
		if (trip.kind !== "draft") return trip;
		// The report lock serializes adds, so the next position is free.
		const [last] = await tx
			.select({ position: sql<number | null>`max(${travelExpenseReportItem.position})` })
			.from(travelExpenseReportItem)
			.where(
				and(
					eq(travelExpenseReportItem.reportId, input.reportId),
					eq(travelExpenseReportItem.organizationId, owner.organizationId),
				),
			);
		const [item] = await tx
			.insert(travelExpenseReportItem)
			.values({
				organizationId: owner.organizationId,
				reportId: input.reportId,
				type: "receipt",
				position: (last?.position ?? -1) + 1,
				originalCurrency: DEFAULT_REIMBURSEMENT_CURRENCY,
				createdAt: at,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.returning();
		if (!item) throw new Error("Failed to create travel expense report item");
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "added", item: toItemView(item, []) };
	});
}

export type RemoveTripReportItemResult =
	| { kind: "removed"; itemId: string; receiptIds: string[] }
	/** The expense changed since `expectedVersion`; it was kept. */
	| { kind: "conflict"; item: ReportItemView }
	/** The trip exists, but the expense is not (or no longer) part of it. */
	| { kind: "item_not_found" }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Removes an expense from a draft trip unless it changed since the version the
 * editor saw. Its receipts cascade; the receipt deletion trigger (migration
 * 0113) hands their stored objects to the cleanup worker in this transaction.
 */
export async function removeTripReportItem(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; itemId: string; expectedVersion: number },
	now: Instant = systemClock.nowInstant(),
): Promise<RemoveTripReportItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const trip = await lockOwnDraftTrip(tx, owner, input.reportId);
		if (trip.kind !== "draft") return trip;
		const item = and(
			eq(travelExpenseReportItem.id, input.itemId),
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
		);
		const receipts = await itemReceipts(tx, owner, input.itemId);
		const [removed] = await tx
			.delete(travelExpenseReportItem)
			.where(and(item, eq(travelExpenseReportItem.version, input.expectedVersion)))
			.returning({ id: travelExpenseReportItem.id });
		if (!removed) {
			const [current] = await tx.select().from(travelExpenseReportItem).where(item);
			return current
				? { kind: "conflict", item: toItemView(current, receipts) }
				: { kind: "item_not_found" };
		}
		const receiptIds = receipts.map((receipt) => receipt.id);
		if (receiptIds.length > 0) {
			// The trigger stamps database time; align it with the clock the worker uses.
			await tx
				.update(travelExpenseReceiptUpload)
				.set({ nextAttemptAt: at, createdAt: at, updatedAt: at })
				.where(
					and(
						inArray(travelExpenseReceiptUpload.id, receiptIds),
						eq(travelExpenseReceiptUpload.organizationId, owner.organizationId),
						eq(travelExpenseReceiptUpload.status, "cleanup_required"),
					),
				);
		}
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "removed", itemId: removed.id, receiptIds };
	});
}

async function itemReceipts(
	tx: Transaction,
	owner: ReportOwner,
	itemId: string,
): Promise<ReportReceiptView[]> {
	const rows = await tx
		.select(receiptViewColumns)
		.from(travelExpenseReportReceipt)
		.where(
			and(
				eq(travelExpenseReportReceipt.itemId, itemId),
				eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
			),
		)
		.orderBy(asc(travelExpenseReportReceipt.createdAt), asc(travelExpenseReportReceipt.id));
	return rows.map(toReceiptView);
}
