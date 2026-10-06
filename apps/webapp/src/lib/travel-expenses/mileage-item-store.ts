import { and, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseReport, travelExpenseReportItem } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { loadOrganizationReimbursementCurrency } from "./conversion-read";
import {
	type MileageItemDraft,
	type MileageItemView,
	mileageItemView,
	type StampedMileagePolicy,
} from "./mileage";
import { loadMileagePricer } from "./mileage-pricing";
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

/** Values of a new mileage item: always the employee's own vehicle, so employee-paid. */
function newMileageItem(owner: ReportOwner, reportId: string, position: number, at: Date) {
	return {
		organizationId: owner.organizationId,
		reportId,
		type: "mileage" as const,
		position,
		paidBy: "employee" as const,
		mileageVehicle: "car" as const,
		createdAt: at,
		updatedAt: at,
		updatedBy: owner.userId,
	};
}

/** Creates a standalone report holding one empty mileage item. */
export async function createStandaloneMileageReport(
	database: Database,
	owner: ReportOwner,
	now: Instant = systemClock.nowInstant(),
): Promise<{ reportId: string; itemId: string }> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
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
			.values(newMileageItem(owner, report.id, 0, at))
			.returning({ id: travelExpenseReportItem.id });
		if (!item) throw new Error("Failed to create travel expense report item");
		return { reportId: report.id, itemId: item.id };
	});
}

export type AddTripMileageItemResult =
	| { kind: "added"; item: ReportItemView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/** Appends an empty mileage item to a draft trip, after its last expense. */
export async function addTripMileageItem(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<AddTripMileageItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		if (report.kind !== "trip") return { kind: "not_found" };
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
			.values(newMileageItem(owner, input.reportId, (last?.position ?? -1) + 1, at))
			.returning();
		if (!item) throw new Error("Failed to create travel expense report item");
		await touchReport(tx, owner, input.reportId, at);
		// Without a date and distance there is nothing to price yet.
		return { kind: "added", item: toItemView(item, [], { status: "incomplete" }) };
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
		const price = await loadMileagePricer(tx, owner.organizationId, [current]);
		const view = toItemView(
			current,
			[],
			price(current, {
				reimbursementCurrency: reportRow?.currency ?? DEFAULT_REIMBURSEMENT_CURRENCY,
				useStamp: false,
			}),
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
	for (const item of mileageItems) {
		const calculation = price(item, {
			reimbursementCurrency: input.reimbursementCurrency,
			useStamp: false,
		});
		const stamp: StampedMileagePolicy | null =
			calculation.status === "calculated" && item.expenseDate
				? { ...calculation.policy, expenseDate: item.expenseDate }
				: null;
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
		views.set(item.id, mileageItemView(item, calculation));
	}
	return views;
}
