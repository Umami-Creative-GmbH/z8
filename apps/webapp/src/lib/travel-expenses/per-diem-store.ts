import { and, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportPerDiem,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	emptyPerDiemItinerary,
	type PerDiemItemView,
	type PerDiemItinerary,
	perDiemItemView,
	perDiemStampOf,
} from "./per-diem";
import { loadPerDiemViews, type PerDiemReportScope } from "./per-diem-pricing";
import {
	lockOwnDraftReport,
	type ReportItemView,
	type ReportOwner,
	toItemView,
	touchReport,
} from "./report-store";

/**
 * Per diem items of trip reports (#609). A trip has at most one; drafts store
 * only the entered itinerary and meals (`per-diem-pricing.ts` calculates them
 * on read), and submission stamps the applied rule edition and policy
 * versions under the report lock. Every write and the submission check also
 * take the employee's per diem lock, so the check for days another report
 * already claims cannot race a concurrent edit of the other report.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ItemRow = typeof travelExpenseReportItem.$inferSelect;

/** Serializes per diem writes and submission checks of one employee until commit. */
async function lockEmployeePerDiem(
	tx: Transaction,
	scope: { organizationId: string; employeeId: string },
): Promise<void> {
	const key = `travel_expense_per_diem:${scope.organizationId}:${scope.employeeId}`;
	await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export type AddTripPerDiemItemResult =
	| { kind: "added"; item: ReportItemView }
	/** The trip already has its per diem. */
	| { kind: "already_exists" }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/** Appends the trip's per diem, its zones preset to the trip's zone. */
export async function addTripPerDiemItem(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<AddTripPerDiemItemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		// Per diem belongs to a trip (spec decision 17).
		if (report.kind !== "trip") return { kind: "not_found" };
		const scope = and(
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
		);
		const [existing] = await tx
			.select({ id: travelExpenseReportItem.id })
			.from(travelExpenseReportItem)
			.where(and(scope, eq(travelExpenseReportItem.type, "per_diem")))
			.limit(1);
		if (existing) return { kind: "already_exists" };
		// The report lock serializes adds, so the next position is free.
		const [last] = await tx
			.select({ position: sql<number | null>`max(${travelExpenseReportItem.position})` })
			.from(travelExpenseReportItem)
			.where(scope);
		const [trip] = await tx
			.select({ timeZone: travelExpenseReport.tripTimeZone })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, input.reportId),
					eq(travelExpenseReport.organizationId, owner.organizationId),
				),
			);
		const [item] = await tx
			.insert(travelExpenseReportItem)
			.values({
				organizationId: owner.organizationId,
				reportId: input.reportId,
				type: "per_diem",
				position: (last?.position ?? -1) + 1,
				paidBy: "employee",
				createdAt: at,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.returning();
		if (!item) throw new Error("Failed to create travel expense report item");
		const itinerary = emptyPerDiemItinerary(trip?.timeZone ?? null);
		await tx.insert(travelExpenseReportPerDiem).values({
			itemId: item.id,
			organizationId: owner.organizationId,
			reportId: input.reportId,
			startTimeZone: itinerary.startTimeZone,
			endTimeZone: itinerary.endTimeZone,
		});
		await touchReport(tx, owner, input.reportId, at);
		return {
			kind: "added",
			item: {
				...toItemView(item, []),
				perDiem: perDiemItemView(itinerary, { status: "incomplete" }),
			},
		};
	});
}

export type SavePerDiemResult =
	| { kind: "saved"; item: ReportItemView }
	/** The item changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; item: ReportItemView }
	| { kind: "not_found" }
	| { kind: "not_draft" };

async function loadReportScope(
	tx: Transaction,
	owner: Pick<ReportOwner, "organizationId" | "employeeId">,
	reportId: string,
): Promise<PerDiemReportScope | null> {
	const [report] = await tx
		.select({
			id: travelExpenseReport.id,
			organizationId: travelExpenseReport.organizationId,
			employeeId: travelExpenseReport.employeeId,
			reimbursementCurrency: travelExpenseReport.reimbursementCurrency,
			tripDestinations: travelExpenseReport.tripDestinations,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
			),
		);
	return report ?? null;
}

/**
 * Saves the complete entered itinerary of the trip's per diem on top of the
 * version the editor last saw, and returns it calculated with the current
 * policy. Clears any stamp: an edited draft is calculated afresh.
 */
export async function savePerDiemDraft(
	database: Database,
	owner: ReportOwner,
	input: {
		reportId: string;
		itemId: string;
		expectedVersion: number;
		itinerary: PerDiemItinerary;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<SavePerDiemResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const locked = await lockOwnDraftReport(tx, owner, input.reportId);
		if (locked.status !== "draft") return { kind: locked.status };
		await lockEmployeePerDiem(tx, owner);
		const item = and(
			eq(travelExpenseReportItem.id, input.itemId),
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
			eq(travelExpenseReportItem.type, "per_diem"),
		);
		const { itinerary } = input;
		const [saved] = await tx
			.update(travelExpenseReportItem)
			.set({
				// The first travel day dates the item in lists and exports.
				expenseDate: itinerary.startDate,
				version: sql`${travelExpenseReportItem.version} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(and(item, eq(travelExpenseReportItem.version, input.expectedVersion)))
			.returning();
		if (saved) {
			await tx
				.update(travelExpenseReportPerDiem)
				.set({
					startDate: itinerary.startDate,
					startTime: itinerary.startTime,
					startTimeZone: itinerary.startTimeZone,
					endDate: itinerary.endDate,
					endTime: itinerary.endTime,
					endTimeZone: itinerary.endTimeZone,
					overnight: itinerary.overnight,
					prolongedWorkplace: itinerary.prolongedWorkplace,
					meals: itinerary.meals,
					policy: null,
				})
				.where(
					and(
						eq(travelExpenseReportPerDiem.itemId, input.itemId),
						eq(travelExpenseReportPerDiem.organizationId, owner.organizationId),
						eq(travelExpenseReportPerDiem.reportId, input.reportId),
					),
				);
		}
		const [current] = saved ? [saved] : await tx.select().from(travelExpenseReportItem).where(item);
		const report = await loadReportScope(tx, owner, input.reportId);
		if (!current || !report) return { kind: "not_found" };
		const views = await loadPerDiemViews(tx, report, [current], { useStamp: false });
		const view: ReportItemView = {
			...toItemView(current, []),
			perDiem: views.get(current.id) ?? null,
		};
		if (!saved) return { kind: "conflict", item: view };
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "saved", item: view };
	});
}

/**
 * Submission (#609), under the report lock: calculates the trip's per diem
 * with the policy versions effective on its days and the current check for
 * days other reports claim, and stamps the rule edition and versions on it
 * (or clears the stamp when it cannot be calculated), so the frozen facts and
 * every later compare use exactly these. Returns the views for the check.
 */
export async function stampPerDiemPolicies(
	tx: Transaction,
	input: { report: PerDiemReportScope; items: readonly Pick<ItemRow, "id" | "type">[] },
): Promise<Map<string, PerDiemItemView>> {
	if (!input.items.some((item) => item.type === "per_diem")) return new Map();
	await lockEmployeePerDiem(tx, input.report);
	const views = await loadPerDiemViews(tx, input.report, input.items, { useStamp: false });
	for (const [itemId, view] of views) {
		const calculation = view.calculation;
		await tx
			.update(travelExpenseReportPerDiem)
			.set({ policy: calculation?.status === "calculated" ? perDiemStampOf(calculation) : null })
			.where(
				and(
					eq(travelExpenseReportPerDiem.itemId, itemId),
					eq(travelExpenseReportPerDiem.organizationId, input.report.organizationId),
					eq(travelExpenseReportPerDiem.reportId, input.report.id),
				),
			);
	}
	return views;
}
