import { and, eq, gte, inArray, isNotNull, lte, ne, notInArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	travelExpenseClaim,
	travelExpenseReport,
	type travelExpenseReportItem,
	travelExpenseReportPerDiem,
} from "@/db/schema";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { type AllowanceOverride, overriddenPerDiemView } from "./allowance-override";
import { loadActiveAllowanceOverrides } from "./allowance-override-read";
import { parseUnits, STORED_AMOUNT_SCALE } from "./money";
import {
	calculatePerDiem,
	type PerDiemCalculation,
	type PerDiemItemView,
	type PerDiemItinerary,
	type PerDiemPolicyResolver,
	perDiemItemView,
	perDiemPolicyResolver,
	perDiemStampResolver,
	type StampedPerDiemPolicy,
	tripDays,
} from "./per-diem";
import { loadAdjustmentFamilyIds } from "./adjustment-link";
import { loadPerDiemPolicyVersions } from "./per-diem-policy-store";
import type { TripDestination } from "./trip-destination";

/**
 * Calculates per diem items (#609) for reads. An editable report is
 * calculated with the organization's current per diem policy and the current
 * check for days other reports already pay; a submitted per diem keeps the
 * rule edition, policy versions and claimed days stamped on it at submission.
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
 * Reports whose per diem counts as claimed: submitted or decided ones, and
 * returned ones (already submitted once, being corrected). Drafts do not:
 * they are no claim yet, and two drafts of one employee would otherwise block
 * each other. They cannot both pay a day either, because submission takes the
 * employee's per diem lock (`stampPerDiemPolicies`) and the report submitted
 * second then sees the first. Adjustments (#615) of other reports count like
 * any report: an adjustment carries its trip's complete corrected per diem,
 * which may pay days its original did not.
 */
const CLAIMING_REPORT_STATUSES = ["submitted", "approved", "returned"] as const;

const ZERO = BigInt(0);

function isPositiveAmount(amount: string): boolean {
	return (parseUnits(amount, STORED_AMOUNT_SCALE) ?? ZERO) > ZERO;
}

/**
 * Days of `[startDate, endDate]` another per diem of the employee already pays
 * a positive allowance for (one allowance per calendar day, see
 * `calculatePerDiem`): days of another claiming report's per diem whose amount
 * there is above zero, and every logical day of a pending or approved legacy
 * per diem claim (it has no daily breakdown). A per diem whose daily amounts
 * are unknown (an applying administrator override above zero, or one not
 * calculated now) counts with all its days; one overridden with zero with none.
 * The own report's adjustment family (#615) describes the same days and never
 * counts.
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
	const family = await loadAdjustmentFamilyIds(database, input);
	const [reports, claims] = await Promise.all([
		database
			.select({
				row: travelExpenseReportPerDiem,
				status: travelExpenseReport.status,
				reimbursementCurrency: travelExpenseReport.reimbursementCurrency,
				tripDestinations: travelExpenseReport.tripDestinations,
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
					...(family.length > 0 ? [notInArray(travelExpenseReport.id, family)] : []),
					inArray(travelExpenseReport.status, [...CLAIMING_REPORT_STATUSES]),
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
	const range = new Set(tripDays(input.startDate, input.endDate));
	const claimed = new Set<string>();
	const claim = (dates: readonly string[]) => {
		for (const date of dates) if (range.has(date)) claimed.add(date);
	};
	for (const other of claims) {
		if (other.startDate && other.endDate) claim(tripDays(other.startDate, other.endDate));
	}
	if (reports.length > 0) {
		const overrides = await loadActiveAllowanceOverrides(database, {
			organizationId: input.organizationId,
			itemIds: reports.map(({ row }) => row.itemId),
		});
		// Only a per diem edited since its return lacks a stamp; it is priced with today's policy.
		let resolvePolicy: PerDiemPolicyResolver | null = null;
		for (const { row, ...report } of reports) {
			const itinerary = itineraryOf(row);
			let calculation = calculateStampedPerDiem(report, itinerary, row.policy);
			if (!calculation && report.status === "returned") {
				resolvePolicy ??= perDiemPolicyResolver(
					// Loaded at most once, and only when a returned per diem has no stamp.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					await loadPerDiemPolicyVersions(database, input.organizationId),
				);
				calculation = calculatePerDiem(itinerary, {
					trip: { destinations: report.tripDestinations },
					reimbursementCurrency: report.reimbursementCurrency,
					resolvePolicy,
				});
			}
			claim(allowanceDaysOf(report, itinerary, calculation, overrides.get(row.itemId)));
		}
	}
	return [...claimed].toSorted();
}

/** The days a per diem pays an allowance for, as `loadPerDiemOverlaps` counts them. */
function allowanceDaysOf(
	report: Pick<PerDiemReportScope, "reimbursementCurrency" | "tripDestinations">,
	itinerary: PerDiemItinerary,
	calculation: PerDiemCalculation | null,
	override: AllowanceOverride | undefined,
): string[] {
	const view = overriddenPerDiemView(
		perDiemItemView(itinerary, calculation),
		report.tripDestinations,
		override,
		report.reimbursementCurrency,
	);
	const allDays =
		itinerary.startDate && itinerary.endDate
			? tripDays(itinerary.startDate, itinerary.endDate)
			: [];
	if (view.override?.applies) return isPositiveAmount(view.override.amount) ? allDays : [];
	if (calculation?.status !== "calculated") return allDays;
	return calculation.days.filter((day) => isPositiveAmount(day.amount)).map((day) => day.date);
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
		// Days another report paid at submission stay unpaid here, whatever happened to it since.
		overlappingDays: stamp.claimedDays ?? [],
		...(stamp.foreignTableKey ? { foreignTableKey: stamp.foreignTableKey } : {}),
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
	// Administrator overrides (#610) apply while the itinerary is the one they were authorized for.
	const overrides = await loadActiveAllowanceOverrides(database, {
		organizationId: report.organizationId,
		itemIds: ids,
	});
	for (const row of rows) {
		const itinerary = itineraryOf(row);
		const calculation = resolvePolicy
			? calculatePerDiem(itinerary, {
					trip: { destinations: report.tripDestinations },
					reimbursementCurrency: report.reimbursementCurrency,
					resolvePolicy,
					// A trip has one per diem, and save/submission callers pass their transaction here.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					overlappingDays: await overlapsOf(database, report, itinerary),
				})
			: calculateStampedPerDiem(report, itinerary, row.policy);
		views.set(
			row.itemId,
			overriddenPerDiemView(
				perDiemItemView(itinerary, calculation),
				report.tripDestinations,
				overrides.get(row.itemId),
				report.reimbursementCurrency,
			),
		);
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
