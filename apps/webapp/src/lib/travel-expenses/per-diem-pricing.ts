import { and, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	travelExpenseClaim,
	travelExpenseReport,
	type travelExpenseReportItem,
	travelExpenseReportPerDiem,
} from "@/db/schema";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	calculatePerDiem,
	type PerDiemCalculation,
	type PerDiemItemView,
	type PerDiemItinerary,
	perDiemItemView,
	perDiemPolicyResolver,
	perDiemStampResolver,
	type StampedPerDiemPolicy,
	tripDays,
} from "./per-diem";
import { loadPerDiemPolicyVersions } from "./per-diem-policy-store";
import type { TripDestination } from "./trip-destination";

/**
 * Calculates per diem items (#609) for reads. An editable report is
 * calculated with the organization's current per diem policy and the current
 * check for days other reports already claim; a submitted per diem keeps the
 * rule edition and policy versions stamped on it at submission.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;
export type PerDiemRow = typeof travelExpenseReportPerDiem.$inferSelect;
type ItemRow = typeof travelExpenseReportItem.$inferSelect;

/** The report facts a per diem calculation reads. */
export interface PerDiemReportScope {
	id: string;
	organizationId: string;
	employeeId: string;
	reimbursementCurrency: string;
	tripDestinations: TripDestination[];
}

export function itineraryOf(
	row: Omit<PerDiemRow, "itemId" | "organizationId" | "reportId" | "policy">,
): PerDiemItinerary {
	return {
		startDate: row.startDate,
		startTime: row.startTime,
		startTimeZone: row.startTimeZone,
		endDate: row.endDate,
		endTime: row.endTime,
		endTimeZone: row.endTimeZone,
		overnight: row.overnight,
		prolongedWorkplace: row.prolongedWorkplace,
		meals: row.meals ?? [],
	};
}

/**
 * Calendar days of `[startDate, endDate]` that another per diem of the
 * employee already covers: any other report that is not rejected (drafts
 * included, so two drafts cannot both be submitted for one day), and pending
 * or approved legacy per diem claims with logical travel dates. R 9.6 Abs. 2
 * LStR allows one allowance per calendar day.
 */
export async function loadPerDiemOverlaps(
	database: Reader,
	input: {
		organizationId: string;
		employeeId: string;
		reportId: string;
		startDate: string;
		endDate: string;
	},
): Promise<string[]> {
	const [reports, claims] = await Promise.all([
		database
			.select({
				startDate: travelExpenseReportPerDiem.startDate,
				endDate: travelExpenseReportPerDiem.endDate,
			})
			.from(travelExpenseReportPerDiem)
			.innerJoin(
				travelExpenseReport,
				and(
					eq(travelExpenseReport.id, travelExpenseReportPerDiem.reportId),
					eq(travelExpenseReport.organizationId, travelExpenseReportPerDiem.organizationId),
				),
			)
			.where(
				and(
					eq(travelExpenseReportPerDiem.organizationId, input.organizationId),
					eq(travelExpenseReport.employeeId, input.employeeId),
					ne(travelExpenseReport.id, input.reportId),
					ne(travelExpenseReport.status, "rejected"),
					isNotNull(travelExpenseReportPerDiem.startDate),
					isNotNull(travelExpenseReportPerDiem.endDate),
					lte(travelExpenseReportPerDiem.startDate, input.endDate),
					gte(travelExpenseReportPerDiem.endDate, input.startDate),
				),
			),
		database
			.select({
				startDate: travelExpenseClaim.tripStartDate,
				endDate: travelExpenseClaim.tripEndDate,
			})
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, input.organizationId),
					eq(travelExpenseClaim.employeeId, input.employeeId),
					eq(travelExpenseClaim.type, "per_diem"),
					inArray(travelExpenseClaim.status, ["submitted", "approved"]),
					lte(travelExpenseClaim.tripStartDate, input.endDate),
					gte(travelExpenseClaim.tripEndDate, input.startDate),
				),
			),
	]);
	const claimed = new Set<string>();
	for (const other of [...reports, ...claims]) {
		if (!other.startDate || !other.endDate) continue;
		const from = parsePlainDate(other.startDate);
		const to = parsePlainDate(other.endDate);
		for (const day of tripDays(input.startDate, input.endDate)) {
			const date = parsePlainDate(day);
			if (comparePlainDates(date, from) >= 0 && comparePlainDates(date, to) <= 0) claimed.add(day);
		}
	}
	return [...claimed].toSorted();
}

async function overlapsOf(
	database: Reader,
	report: PerDiemReportScope,
	itinerary: PerDiemItinerary,
): Promise<string[]> {
	const { startDate, endDate } = itinerary;
	if (!startDate || !endDate) return [];
	if (comparePlainDates(parsePlainDate(endDate), parsePlainDate(startDate)) < 0) return [];
	return loadPerDiemOverlaps(database, {
		organizationId: report.organizationId,
		employeeId: report.employeeId,
		reportId: report.id,
		startDate,
		endDate,
	});
}

/** The calculation of a submitted per diem from its stamp alone; null without a stamp. */
export function calculateStampedPerDiem(
	report: Pick<PerDiemReportScope, "reimbursementCurrency" | "tripDestinations">,
	itinerary: PerDiemItinerary,
	stamp: StampedPerDiemPolicy | null,
): PerDiemCalculation | null {
	if (!stamp) return null;
	return calculatePerDiem(itinerary, {
		trip: { destinations: report.tripDestinations },
		reimbursementCurrency: report.reimbursementCurrency,
		resolvePolicy: perDiemStampResolver(stamp),
		rulesKey: stamp.rulesKey,
	});
}

/**
 * Per diem views of the items of one report, by item ID; items of other
 * types are absent. `useStamp` reads submitted per diems from their stamp.
 */
export async function loadPerDiemViews(
	database: Reader,
	report: PerDiemReportScope,
	items: readonly Pick<ItemRow, "id" | "type">[],
	options: { useStamp: boolean },
): Promise<Map<string, PerDiemItemView>> {
	const views = new Map<string, PerDiemItemView>();
	const ids = items.filter((item) => item.type === "per_diem").map((item) => item.id);
	if (ids.length === 0) return views;
	const rows = await database
		.select()
		.from(travelExpenseReportPerDiem)
		.where(
			and(
				eq(travelExpenseReportPerDiem.organizationId, report.organizationId),
				eq(travelExpenseReportPerDiem.reportId, report.id),
				inArray(travelExpenseReportPerDiem.itemId, ids),
			),
		);
	const resolvePolicy = options.useStamp
		? null
		: perDiemPolicyResolver(await loadPerDiemPolicyVersions(database, report.organizationId));
	for (const row of rows) {
		const itinerary = itineraryOf(row);
		const calculation = resolvePolicy
			? calculatePerDiem(itinerary, {
					trip: { destinations: report.tripDestinations },
					reimbursementCurrency: report.reimbursementCurrency,
					resolvePolicy,
					overlappingDays: await overlapsOf(database, report, itinerary),
				})
			: calculateStampedPerDiem(report, itinerary, row.policy);
		views.set(row.itemId, perDiemItemView(itinerary, calculation));
	}
	return views;
}

/** The per diem rows of a report for the frozen facts, read by report alone like its items. */
export function loadReportPerDiemRows(database: Reader, reportId: string): Promise<PerDiemRow[]> {
	return database
		.select()
		.from(travelExpenseReportPerDiem)
		.where(eq(travelExpenseReportPerDiem.reportId, reportId));
}
