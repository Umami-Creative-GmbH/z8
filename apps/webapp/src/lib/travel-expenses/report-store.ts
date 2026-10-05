import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type TravelExpenseReportItemType,
	type TravelExpenseReportKind,
	type TravelExpenseReportStatus,
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportReceipt,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { DEFAULT_REIMBURSEMENT_CURRENCY, type ReceiptItemDraft } from "./receipt-report";

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

export interface ReportView {
	id: string;
	kind: TravelExpenseReportKind;
	status: TravelExpenseReportStatus;
	reimbursementCurrency: string;
	createdAt: string;
	updatedAt: string;
	items: ReportItemView[];
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
): Promise<{ status: "draft" } | { status: "not_found" } | { status: "not_draft" }> {
	const [report] = await tx
		.select({ status: travelExpenseReport.status })
		.from(travelExpenseReport)
		.where(ownedReport(owner, reportId))
		.for("update");
	if (!report) return { status: "not_found" };
	return report.status === "draft" ? { status: "draft" } : { status: "not_draft" };
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
				eq(travelExpenseReport.status, "draft"),
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
		reimbursementCurrency: report.reimbursementCurrency,
		createdAt: report.createdAt.toISOString(),
		updatedAt: report.updatedAt.toISOString(),
		items: items.map((item) =>
			toItemView(item, receipts.filter((receipt) => receipt.itemId === item.id).map(toReceiptView)),
		),
	};
}

export interface DraftReportSummary {
	id: string;
	kind: TravelExpenseReportKind;
	updatedAt: string;
	expenseDate: string | null;
	description: string | null;
	amount: string | null;
	currency: string | null;
	receiptCount: number;
}

/** The owner's draft reports, most recently edited first, for resuming them. */
export async function listOwnDraftReports(
	database: Database,
	owner: ReportOwner,
): Promise<DraftReportSummary[]> {
	const reports = await database
		.select({
			id: travelExpenseReport.id,
			kind: travelExpenseReport.kind,
			updatedAt: travelExpenseReport.updatedAt,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
				eq(travelExpenseReport.status, "draft"),
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
					eq(travelExpenseReportItem.position, 0),
				),
			),
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
		const item = items.find((candidate) => candidate.reportId === report.id);
		return {
			id: report.id,
			kind: report.kind,
			updatedAt: report.updatedAt.toISOString(),
			expenseDate: item?.expenseDate ?? null,
			description: item?.description ?? null,
			amount: item?.originalAmount ?? null,
			currency: item?.originalCurrency ?? null,
			receiptCount: receiptCounts.find((row) => row.reportId === report.id)?.count ?? 0,
		};
	});
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
