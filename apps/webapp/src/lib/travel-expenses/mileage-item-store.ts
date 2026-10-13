import { and, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseReport, travelExpenseReportItem } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { overriddenMileageView } from "./allowance-override";
import { loadOrganizationReimbursementCurrency } from "./conversion-read";
import {
	type MileageItemDraft,
	type MileageItemView,
	mileageItemView,
	type StampedMileagePolicy,
} from "./mileage";
import { loadMileageOverrides, loadMileagePricer } from "./mileage-pricing";
import { DEFAULT_REIMBURSEMENT_CURRENCY } from "./receipt-report";
import {
	lockOwnDraftReport,
	type ReportItemView,
	type ReportOwner,
	toItemView,
	touchReport,
} from "./report-store";

/**
 * Mileage items of draft reports (#606). Drafts store only what the employee
 * entered; reads price them with the organization's current policy
 * (`mileage-pricing.ts`), and submission stamps the applied policy version
 * under the report lock. A client-calculated amount is never accepted.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ItemRow = typeof travelExpenseReportItem.$inferSelect;

/**
 * Facts a new mileage item starts with when it is pre-filled from own-vehicle
 * work (#1131): the work's local start date, its driven distance and the work
 * period it came from. The route is always left to the employee.
 */
export interface MileageItemPrefill {
	expenseDate: string;
	/** Kilometres at two decimals, as `parseMileageDistance` normalizes them. */
	distanceKm: string;
	sourceWorkPeriodId: string;
}

/** Values of a new mileage item: always the employee's own vehicle, so employee-paid. */
function newMileageItem(
	owner: ReportOwner,
	reportId: string,
	position: number,
	at: Date,
	prefill?: MileageItemPrefill,
) {
	return {
		organizationId: owner.organizationId,
		reportId,
		type: "mileage" as const,
		position,
		paidBy: "employee" as const,
		mileageVehicle: "car" as const,
		...(prefill
			? {
					expenseDate: prefill.expenseDate,
					mileageDistanceKm: prefill.distanceKm,
					sourceWorkPeriodId: prefill.sourceWorkPeriodId,
				}
			: {}),
		createdAt: at,
		updatedAt: at,
		updatedBy: owner.userId,
	};
}

/** Inserts a standalone report holding one (empty or pre-filled) mileage item. */
export async function insertStandaloneMileageReport(
	tx: Transaction,
	owner: ReportOwner,
	at: Date,
	prefill?: MileageItemPrefill,
): Promise<{ reportId: string; itemId: string }> {
	// The organization's reimbursement currency (#607), read at creation only.
	const currency = await loadOrganizationReimbursementCurrency(tx, owner.organizationId);
	const [report] = await tx
		.insert(travelExpenseReport)
		.values({
			organizationId: owner.organizationId,
			employeeId: owner.employeeId,
			kind: "standalone",
			status: "draft",
			reimbursementCurrency: currency,
			createdAt: at,
			createdBy: owner.userId,
			updatedAt: at,
			updatedBy: owner.userId,
		})
		.returning({ id: travelExpenseReport.id });
	if (!report) throw new Error("Failed to create travel expense report");
	const [item] = await tx
		.insert(travelExpenseReportItem)
		.values(newMileageItem(owner, report.id, 0, at, prefill))
		.returning({ id: travelExpenseReportItem.id });
	if (!item) throw new Error("Failed to create travel expense report item");
	return { reportId: report.id, itemId: item.id };
}

/** Creates a standalone report holding one empty mileage item. */
export async function createStandaloneMileageReport(
	database: Database,
	owner: ReportOwner,
	now: Instant = systemClock.nowInstant(),
): Promise<{ reportId: string; itemId: string }> {
	const at = dateFromInstant(now);
	return database.transaction((tx) => insertStandaloneMileageReport(tx, owner, at));
}

export type AddTripMileageItemResult =
	| { kind: "added"; item: ReportItemView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Appends a mileage item to the owner's draft (or returned) trip, after its
 * last expense, under the report lock. Returns the inserted row.
 */
export async function insertTripMileageItem(
	tx: Transaction,
	owner: ReportOwner,
	reportId: string,
	at: Date,
	prefill?: MileageItemPrefill,
): Promise<{ kind: "added"; item: ItemRow } | { kind: "not_found" } | { kind: "not_draft" }> {
	const report = await lockOwnDraftReport(tx, owner, reportId);
	if (report.status !== "draft") return { kind: report.status };
	if (report.kind !== "trip") return { kind: "not_found" };
	// The report lock serializes adds, so the next position is free.
	const [last] = await tx
		.select({ position: sql<number | null>`max(${travelExpenseReportItem.position})` })
		.from(travelExpenseReportItem)
		.where(
			and(
				eq(travelExpenseReportItem.reportId, reportId),
				eq(travelExpenseReportItem.organizationId, owner.organizationId),
			),
		);
	const [item] = await tx
		.insert(travelExpenseReportItem)
		.values(newMileageItem(owner, reportId, (last?.position ?? -1) + 1, at, prefill))
		.returning();
	if (!item) throw new Error("Failed to create travel expense report item");
	await touchReport(tx, owner, reportId, at);
	return { kind: "added", item };
}

/** Appends an empty mileage item to a draft trip, after its last expense. */
export async function addTripMileageItem(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<AddTripMileageItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const added = await insertTripMileageItem(tx, owner, input.reportId, at);
		if (added.kind !== "added") return added;
		// Without a date and distance there is nothing to price yet.
		return { kind: "added", item: toItemView(added.item, [], { status: "incomplete" }) };
	});
}

export type SaveMileageItemResult =
	| { kind: "saved"; item: ReportItemView }
	/** The item changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; item: ReportItemView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Saves the complete entered facts of one mileage item on top of the version
 * the editor last saw, and returns it priced with the current policy. The
 * report row lock serializes it with submission.
 */
export async function saveMileageItemDraft(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; itemId: string; expectedVersion: number; draft: MileageItemDraft },
	now: Instant = systemClock.nowInstant(),
): Promise<SaveMileageItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		const item = and(
			eq(travelExpenseReportItem.id, input.itemId),
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
			eq(travelExpenseReportItem.type, "mileage"),
		);
		const [saved] = await tx
			.update(travelExpenseReportItem)
			.set({
				expenseDate: input.draft.expenseDate,
				mileageRoute: input.draft.route,
				mileageDistanceKm: input.draft.distanceKm,
				mileageVehicle: input.draft.vehicle,
				accountingReference: input.draft.accountingReference,
				// A stamp belongs to one submission; an edited draft is priced afresh.
				mileagePolicy: null,
				version: sql`${travelExpenseReportItem.version} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(and(item, eq(travelExpenseReportItem.version, input.expectedVersion)))
			.returning();
		const [current] = saved ? [saved] : await tx.select().from(travelExpenseReportItem).where(item);
		if (!current) return { kind: "not_found" };
		const [reportRow] = await tx
			.select({ currency: travelExpenseReport.reimbursementCurrency })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, input.reportId),
					eq(travelExpenseReport.organizationId, owner.organizationId),
				),
			);
		// Inside the save transaction: its queries share one connection and run in order anyway.
		// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
		const price = await loadMileagePricer(tx, owner.organizationId, [current]);
		const reimbursementCurrency = reportRow?.currency ?? DEFAULT_REIMBURSEMENT_CURRENCY;
		const overrides = await loadMileageOverrides(tx, owner.organizationId, [current]);
		const view = toItemView(
			current,
			[],
			price(current, { reimbursementCurrency, useStamp: false }),
			{ override: overrides.get(current.id), reimbursementCurrency },
		);
		if (!saved) return { kind: "conflict", item: view };
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "saved", item: view };
	});
}

/**
 * Submission (#606), under the report lock: prices every mileage item of the
 * report with the policy effective on its date and stamps the applied version
 * on the row (or clears the stamp when it cannot be priced), so the frozen
 * facts and every later compare use exactly this version. Returns each
 * mileage item's view for the submission check.
 */
export async function stampMileagePolicies(
	tx: Transaction,
	input: { organizationId: string; reimbursementCurrency: string; items: readonly ItemRow[] },
): Promise<Map<string, MileageItemView | null>> {
	const views = new Map<string, MileageItemView | null>();
	const mileageItems = input.items.filter((item) => item.type === "mileage");
	if (mileageItems.length === 0) return views;
	const price = await loadMileagePricer(tx, input.organizationId, mileageItems);
	// Inside the submission transaction: its queries share one connection and run in order anyway.
	// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
	const overrides = await loadMileageOverrides(tx, input.organizationId, mileageItems);
	for (const item of mileageItems) {
		const calculation = price(item, {
			reimbursementCurrency: input.reimbursementCurrency,
			useStamp: false,
		});
		const stamp: StampedMileagePolicy | null =
			calculation.status === "calculated" && item.expenseDate
				? { ...calculation.policy, expenseDate: item.expenseDate }
				: null;
		// One stamp per item, each a different value, on the submission transaction's connection.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		await tx
			.update(travelExpenseReportItem)
			.set({ mileagePolicy: stamp })
			.where(
				and(
					eq(travelExpenseReportItem.id, item.id),
					eq(travelExpenseReportItem.organizationId, input.organizationId),
					eq(travelExpenseReportItem.type, "mileage"),
				),
			);
		// An applying administrator override (#610) is what the item counts.
		views.set(
			item.id,
			overriddenMileageView(
				mileageItemView(item, calculation),
				item.expenseDate,
				overrides.get(item.id),
				input.reimbursementCurrency,
			),
		);
	}
	return views;
}
