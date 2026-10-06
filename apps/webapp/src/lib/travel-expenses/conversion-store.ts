import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	employee,
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportItemConversion,
	travelExpenseReportReceipt,
	travelExpenseSettings,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { loadReportConversions } from "./conversion-read";
import { conversionFromRow } from "./conversion-row";
import {
	convertToReimbursement,
	type ItemConversion,
	isReimbursementCurrencySupported,
	type ManualRateInput,
	type ParseManualRateResult,
	parseCardChargeAmount,
	parseManualRateInput,
} from "./currency-conversion";
import { EDITABLE_REPORT_STATUSES, isEditableReportStatus } from "./report-return";
import { lockOwnDraftReport, type ReportOwner, touchReport } from "./report-store";

/**
 * Currency conversions of report items (#607) and the organization's
 * reimbursement currency. An employee records an evidenced card charge on
 * their own draft; an expense administrator (the caller checks the
 * permission) authorizes a documented rate on any draft of their
 * organization. Every write holds the report row lock, the lock item saves,
 * receipt finalization and submission take, and advances the item's version,
 * so a submission review always covers the conversion it shows.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

/** Sets the currency of the organization's new reports; existing reports keep theirs. */
export async function saveOrganizationReimbursementCurrency(
	database: Database,
	input: { organizationId: string; userId: string; currency: string },
	now: Instant = systemClock.nowInstant(),
): Promise<{ kind: "saved"; currency: string } | { kind: "unsupported" }> {
	const currency = input.currency.trim().toUpperCase();
	if (!isReimbursementCurrencySupported(currency)) return { kind: "unsupported" };
	const at = dateFromInstant(now);
	await database
		.insert(travelExpenseSettings)
		.values({
			organizationId: input.organizationId,
			reimbursementCurrency: currency,
			updatedAt: at,
			updatedBy: input.userId,
		})
		.onConflictDoUpdate({
			target: travelExpenseSettings.organizationId,
			set: { reimbursementCurrency: currency, updatedAt: at, updatedBy: input.userId },
		});
	return { kind: "saved", currency };
}

type ItemRow = typeof travelExpenseReportItem.$inferSelect;

type DraftItem =
	| { kind: "ok"; item: ItemRow; reimbursementCurrency: string }
	| { kind: "not_found" }
	| { kind: "conflict"; itemVersion: number };

/** The item of a locked draft report, at the version the caller saw. */
async function draftItem(
	tx: Transaction,
	scope: { organizationId: string; reportId: string; itemId: string; expectedVersion: number },
): Promise<DraftItem> {
	const [row] = await tx
		.select({ item: travelExpenseReportItem, currency: travelExpenseReport.reimbursementCurrency })
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
				eq(travelExpenseReportItem.id, scope.itemId),
				eq(travelExpenseReportItem.reportId, scope.reportId),
				eq(travelExpenseReportItem.organizationId, scope.organizationId),
			),
		)
		.limit(1);
	if (!row) return { kind: "not_found" };
	if (row.item.version !== scope.expectedVersion) {
		return { kind: "conflict", itemVersion: row.item.version };
	}
	return { kind: "ok", item: row.item, reimbursementCurrency: row.currency };
}

/** Advances the item's version so reviews and other editors see the change. */
async function bumpItemVersion(
	tx: Transaction,
	item: ItemRow,
	userId: string,
	at: Date,
): Promise<number> {
	const [bumped] = await tx
		.update(travelExpenseReportItem)
		.set({
			version: sql`${travelExpenseReportItem.version} + 1`,
			updatedAt: at,
			updatedBy: userId,
		})
		.where(
			and(
				eq(travelExpenseReportItem.id, item.id),
				eq(travelExpenseReportItem.organizationId, item.organizationId),
				eq(travelExpenseReportItem.version, item.version),
			),
		)
		.returning({ version: travelExpenseReportItem.version });
	// The report lock serializes every item write, so the version cannot move.
	if (!bumped) throw new Error("Report item changed under the report lock");
	return bumped.version;
}

const NO_RATE = {
	rate: null,
	rateBaseCurrency: null,
	rateQuoteCurrency: null,
	rateDate: null,
	reason: null,
	authorizedByEmployeeId: null,
	authorizedByName: null,
	authorizedAt: null,
} as const;

async function upsertConversion(
	tx: Transaction,
	item: ItemRow,
	values: Omit<
		typeof travelExpenseReportItemConversion.$inferInsert,
		"id" | "organizationId" | "reportId" | "itemId" | "createdAt"
	>,
) {
	const [saved] = await tx
		.insert(travelExpenseReportItemConversion)
		.values({
			organizationId: item.organizationId,
			reportId: item.reportId,
			itemId: item.id,
			...values,
		})
		.onConflictDoUpdate({ target: travelExpenseReportItemConversion.itemId, set: values })
		.returning();
	const conversion = saved ? conversionFromRow(saved) : null;
	if (!conversion) throw new Error("Failed to save the report item conversion");
	return conversion;
}

async function deleteConversion(tx: Transaction, item: ItemRow) {
	return tx
		.delete(travelExpenseReportItemConversion)
		.where(
			and(
				eq(travelExpenseReportItemConversion.itemId, item.id),
				eq(travelExpenseReportItemConversion.organizationId, item.organizationId),
			),
		)
		.returning({ basis: travelExpenseReportItemConversion.basis });
}

async function currentConversion(tx: Transaction, item: ItemRow) {
	const [row] = await tx
		.select()
		.from(travelExpenseReportItemConversion)
		.where(
			and(
				eq(travelExpenseReportItemConversion.itemId, item.id),
				eq(travelExpenseReportItemConversion.organizationId, item.organizationId),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Whether the item is in another currency than its report, and in which. */
function foreignPair(item: ItemRow, reimbursementCurrency: string) {
	if (!item.originalCurrency || item.originalCurrency === reimbursementCurrency) return null;
	return { sourceCurrency: item.originalCurrency, targetCurrency: reimbursementCurrency };
}

export type SaveConversionResult =
	| { kind: "saved"; itemVersion: number; conversion: ItemConversion }
	/** The item changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; itemVersion: number }
	/** The item is in the reimbursement currency (or has none): nothing to convert. */
	| { kind: "not_foreign" }
	| { kind: "invalid"; errors: Partial<Record<"chargedAmount" | "evidenceReceiptId", "invalid">> }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Records the employee's actual card charge for their own foreign-currency
 * item, evidenced by one of that item's attachments. A receipt of another
 * item, report or organization is refused.
 */
export async function saveCardChargeConversion(
	database: Database,
	owner: ReportOwner,
	input: {
		reportId: string;
		itemId: string;
		expectedVersion: number;
		chargedAmount: string;
		evidenceReceiptId: string;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<SaveConversionResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		const found = await draftItem(tx, { organizationId: owner.organizationId, ...input });
		if (found.kind !== "ok") return found;
		const { item, reimbursementCurrency } = found;
		const pair = foreignPair(item, reimbursementCurrency);
		if (!pair) return { kind: "not_foreign" };

		const errors: Extract<SaveConversionResult, { kind: "invalid" }>["errors"] = {};
		const chargedAmount = parseCardChargeAmount(input.chargedAmount, reimbursementCurrency);
		if (!chargedAmount) errors.chargedAmount = "invalid";
		const [evidence] = await tx
			.select({ id: travelExpenseReportReceipt.id })
			.from(travelExpenseReportReceipt)
			.where(
				and(
					eq(travelExpenseReportReceipt.id, input.evidenceReceiptId),
					eq(travelExpenseReportReceipt.itemId, item.id),
					eq(travelExpenseReportReceipt.reportId, item.reportId),
					eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
				),
			)
			.limit(1);
		if (!evidence) errors.evidenceReceiptId = "invalid";
		if (!chargedAmount || !evidence) return { kind: "invalid", errors };

		const conversion = await upsertConversion(tx, item, {
			basis: "card_charge",
			...pair,
			chargedAmount,
			evidenceReceiptId: evidence.id,
			...NO_RATE,
			recordedBy: owner.userId,
			updatedAt: at,
		});
		const itemVersion = await bumpItemVersion(tx, item, owner.userId, at);
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "saved", itemVersion, conversion };
	});
}

export type RemoveConversionResult =
	| { kind: "removed"; itemVersion: number }
	| { kind: "conflict"; itemVersion: number }
	/** An administrator authorized this conversion; only they can withdraw it. */
	| { kind: "not_allowed" }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/** Removes the employee's own card charge; an authorized rate stays. */
export async function removeCardChargeConversion(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; itemId: string; expectedVersion: number },
	now: Instant = systemClock.nowInstant(),
): Promise<RemoveConversionResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		const found = await draftItem(tx, { organizationId: owner.organizationId, ...input });
		if (found.kind !== "ok") return found;
		const existing = await currentConversion(tx, found.item);
		if (!existing) return { kind: "not_found" };
		if (existing.basis !== "card_charge") return { kind: "not_allowed" };
		await deleteConversion(tx, found.item);
		const itemVersion = await bumpItemVersion(tx, found.item, owner.userId, at);
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "removed", itemVersion };
	});
}

/** An expense administrator acting in their active organization. */
export interface ConversionAdministrator {
	organizationId: string;
	employeeId: string;
	userId: string;
}

/** The administrator's name, kept by value with the rate they authorize. */
async function administratorName(
	tx: Transaction,
	actor: ConversionAdministrator,
): Promise<string | null> {
	const [row] = await tx
		.select({ name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.id, actor.employeeId),
				eq(employee.organizationId, actor.organizationId),
				eq(employee.userId, actor.userId),
			),
		)
		.limit(1);
	return row?.name ?? null;
}

/** Locks a draft report of the administrator's organization. */
async function lockOrganizationDraftReport(
	tx: Transaction,
	organizationId: string,
	reportId: string,
): Promise<"draft" | "not_found" | "not_draft"> {
	const [report] = await tx
		.select({ status: travelExpenseReport.status })
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		)
		.for("update");
	if (!report) return "not_found";
	// A returned report (#603) is edited like a draft.
	return isEditableReportStatus(report.status) ? "draft" : "not_draft";
}

async function touchReportAsAdministrator(
	tx: Transaction,
	actor: ConversionAdministrator,
	reportId: string,
	at: Date,
) {
	await tx
		.update(travelExpenseReport)
		.set({ updatedAt: at, updatedBy: actor.userId })
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, actor.organizationId),
			),
		);
}

export type AuthorizeRateResult =
	| { kind: "saved"; itemVersion: number; conversion: ItemConversion }
	| { kind: "conflict"; itemVersion: number }
	| { kind: "not_foreign" }
	| { kind: "invalid"; errors: Extract<ParseManualRateResult, { ok: false }>["errors"] }
	/** The rate is valid, but the converted amount rounds to zero or is too large. */
	| { kind: "out_of_range" }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Records a documented rate for a foreign-currency item of any draft report
 * in the administrator's organization, replacing an earlier conversion. The
 * caller must have checked the expense administrator permission.
 */
export async function authorizeManualConversionRate(
	database: Database,
	actor: ConversionAdministrator,
	input: { reportId: string; itemId: string; expectedVersion: number; rate: ManualRateInput },
	now: Instant = systemClock.nowInstant(),
): Promise<AuthorizeRateResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const status = await lockOrganizationDraftReport(tx, actor.organizationId, input.reportId);
		if (status !== "draft") return { kind: status };
		const found = await draftItem(tx, { organizationId: actor.organizationId, ...input });
		if (found.kind !== "ok") return found;
		const { item, reimbursementCurrency } = found;
		const pair = foreignPair(item, reimbursementCurrency);
		if (!pair || !item.originalAmount) return { kind: "not_foreign" };
		const parsed = parseManualRateInput(input.rate, pair);
		if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
		const { rate, rateDate, reason } = parsed.value;
		const preview = convertToReimbursement(
			{ amount: item.originalAmount, currency: pair.sourceCurrency },
			reimbursementCurrency,
			{
				basis: "manual_rate",
				...pair,
				rate,
				rateDate,
				reason,
				authorizedBy: { employeeId: actor.employeeId, name: "" },
				authorizedAt: "",
			},
		);
		if (preview.kind !== "converted") return { kind: "out_of_range" };
		const name = await administratorName(tx, actor);
		if (!name) return { kind: "not_found" };

		const conversion = await upsertConversion(tx, item, {
			basis: "manual_rate",
			...pair,
			chargedAmount: null,
			evidenceReceiptId: null,
			rate: rate.value,
			rateBaseCurrency: rate.base,
			rateQuoteCurrency: rate.quote,
			rateDate,
			reason,
			authorizedByEmployeeId: actor.employeeId,
			authorizedByName: name,
			authorizedAt: at,
			recordedBy: actor.userId,
			updatedAt: at,
		});
		const itemVersion = await bumpItemVersion(tx, item, actor.userId, at);
		await touchReportAsAdministrator(tx, actor, input.reportId, at);
		return { kind: "saved", itemVersion, conversion };
	});
}

/** Withdraws any conversion of a draft item of the administrator's organization. */
export async function clearItemConversion(
	database: Database,
	actor: ConversionAdministrator,
	input: { reportId: string; itemId: string; expectedVersion: number },
	now: Instant = systemClock.nowInstant(),
): Promise<Exclude<RemoveConversionResult, { kind: "not_allowed" }>> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const status = await lockOrganizationDraftReport(tx, actor.organizationId, input.reportId);
		if (status !== "draft") return { kind: status };
		const found = await draftItem(tx, { organizationId: actor.organizationId, ...input });
		if (found.kind !== "ok") return found;
		const removed = await deleteConversion(tx, found.item);
		if (removed.length === 0) return { kind: "not_found" };
		const itemVersion = await bumpItemVersion(tx, found.item, actor.userId, at);
		await touchReportAsAdministrator(tx, actor, input.reportId, at);
		return { kind: "removed", itemVersion };
	});
}

export interface ForeignDraftItem {
	reportId: string;
	itemId: string;
	itemVersion: number;
	employeeName: string;
	expenseDate: string | null;
	description: string | null;
	amount: string | null;
	currency: string;
	reimbursementCurrency: string;
	/** Null when none is recorded, or the one recorded is for another currency pair. */
	conversion: ItemConversion | null;
}

/**
 * Foreign-currency items of the organization's draft and returned reports, for expense
 * administrators to authorize documented rates. Most recently edited first.
 */
export async function listForeignDraftItems(
	database: Reader,
	organizationId: string,
	limit = 200,
): Promise<ForeignDraftItem[]> {
	const rows = await database
		.select({
			reportId: travelExpenseReport.id,
			reimbursementCurrency: travelExpenseReport.reimbursementCurrency,
			item: travelExpenseReportItem,
			employeeName: user.name,
		})
		.from(travelExpenseReportItem)
		.innerJoin(
			travelExpenseReport,
			and(
				eq(travelExpenseReport.id, travelExpenseReportItem.reportId),
				eq(travelExpenseReport.organizationId, travelExpenseReportItem.organizationId),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, travelExpenseReport.employeeId),
				eq(employee.organizationId, travelExpenseReport.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(travelExpenseReport.organizationId, organizationId),
				inArray(travelExpenseReport.status, [...EDITABLE_REPORT_STATUSES]),
				isNotNull(travelExpenseReportItem.originalCurrency),
				ne(travelExpenseReportItem.originalCurrency, travelExpenseReport.reimbursementCurrency),
			),
		)
		.orderBy(desc(travelExpenseReportItem.updatedAt), asc(travelExpenseReportItem.id))
		.limit(limit);
	const conversions = await loadReportConversions(database, {
		organizationId,
		reportIds: [...new Set(rows.map((row) => row.reportId))],
	});
	return rows.map((row) => {
		const conversion = conversions.get(row.item.id) ?? null;
		const applies =
			conversion?.sourceCurrency === row.item.originalCurrency &&
			conversion.targetCurrency === row.reimbursementCurrency;
		return {
			reportId: row.reportId,
			itemId: row.item.id,
			itemVersion: row.item.version,
			employeeName: row.employeeName,
			expenseDate: row.item.expenseDate,
			description: row.item.description,
			amount: row.item.originalAmount,
			currency: row.item.originalCurrency ?? "",
			reimbursementCurrency: row.reimbursementCurrency,
			conversion: applies ? conversion : null,
		};
	});
}
