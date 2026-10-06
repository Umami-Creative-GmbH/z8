import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";
import type {
	PerDiemArea,
	PerDiemDayBreakdown,
	PerDiemMealDay,
	PerDiemOvernight,
	StampedPerDiemPolicy,
} from "@/lib/travel-expenses/per-diem";
import { calculateStampedPerDiem, itineraryOf } from "@/lib/travel-expenses/per-diem-pricing";
import type { PerDiemRates } from "@/lib/travel-expenses/statutory-per-diem-defaults";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { ApprovalEvidenceError } from "./errors";

/**
 * Frozen per diem facts (#609, schema version 7). A per diem item freezes its
 * entered itinerary and meals, the rule edition and policy versions stamped
 * at submission, and the complete daily breakdown. Facts are recalculated
 * from the stamp only, never from today's policy or overlap check, so the
 * compare snapshot of an unchanged per diem equals the frozen one. Like
 * mileage, the item also freezes `category: "meals"`, a fixed description and
 * the calculated amount as `original`, so every reader of item amounts works.
 */

export const PER_DIEM_FACTS_SCHEMA_VERSION = 7;
export const PER_DIEM_FACTS_DESCRIPTION = "Per diem";

/** A per diem row as the facts loader reads it (`travel_expense_report_per_diem`). */
export interface TravelExpenseReportPerDiemRow {
	itemId: string;
	organizationId: string;
	reportId: string;
	startDate: string | null;
	startTime: string | null;
	startTimeZone: string | null;
	endDate: string | null;
	endTime: string | null;
	endTimeZone: string | null;
	overnight: PerDiemOvernight | null;
	prolongedWorkplace: boolean;
	meals: PerDiemMealDay[];
	policy: StampedPerDiemPolicy | null;
}

export interface TravelExpenseReportSubmittedPerDiem {
	/** Local travel times exactly as entered, with their canonical UTC instants. */
	start: { date: string; time: string; timeZone: string; at: string };
	end: { date: string; time: string; timeZone: string; at: string };
	/** Null for a single-day trip. */
	overnight: PerDiemOvernight | null;
	absenceMinutes: number;
	meals: PerDiemMealDay[];
	days: PerDiemDayBreakdown[];
	currency: string;
	/** Sum of the day amounts; "0.00" is a legitimate submitted result. */
	amount: string;
	rules: { key: string; reference: string; version: string };
	policies: {
		policyId: string;
		versionId: string;
		effectiveFrom: string;
		source: AllowancePolicySource;
		area: PerDiemArea;
		rates: PerDiemRates;
	}[];
}

export function assertPerDiemScope(
	rows: ReadonlyArray<TravelExpenseReportPerDiemRow>,
	report: { id: string; organizationId: string },
	items: ReadonlyArray<{ id: string; type: string }>,
): void {
	const seen = new Set<string>();
	for (const row of rows) {
		const item = items.find((candidate) => candidate.id === row.itemId);
		if (
			row.organizationId !== report.organizationId ||
			row.reportId !== report.id ||
			item?.type !== "per_diem" ||
			seen.has(row.itemId)
		) {
			throw new ApprovalEvidenceError("invariant", { field: "per_diem_scope" });
		}
		seen.add(row.itemId);
	}
}

/**
 * The `perDiem` facts of one per diem item and its amount, or null when the
 * live rows cannot be priced as stamped (compare mode only: such rows differ
 * from any revision; submit mode refuses them).
 */
export function submittedPerDiemFacts(
	row: TravelExpenseReportPerDiemRow | undefined,
	report: { reimbursementCurrency: string; tripDestinations: TripDestination[] },
): TravelExpenseReportSubmittedPerDiem | null {
	if (!row) return null;
	const itinerary = itineraryOf(row);
	const calculation = calculateStampedPerDiem(report, itinerary, row.policy);
	if (calculation?.status !== "calculated") return null;
	const { startDate, startTime, startTimeZone, endDate, endTime, endTimeZone } = itinerary;
	if (!startDate || !startTime || !startTimeZone || !endDate || !endTime || !endTimeZone) {
		return null;
	}
	return {
		start: {
			date: startDate,
			time: startTime,
			timeZone: startTimeZone,
			at: calculation.absence.startAt,
		},
		end: { date: endDate, time: endTime, timeZone: endTimeZone, at: calculation.absence.endAt },
		overnight: startDate === endDate ? null : itinerary.overnight,
		absenceMinutes: calculation.absence.minutes,
		meals: structuredClone(itinerary.meals),
		days: structuredClone(calculation.days),
		currency: calculation.currency,
		amount: calculation.amount,
		rules: { ...calculation.rules },
		policies: calculation.policies.map((policy) => ({
			policyId: policy.policyId,
			versionId: policy.versionId,
			effectiveFrom: policy.effectiveFrom,
			source: { ...policy.source },
			area: policy.area,
			rates: { ...policy.rates },
		})),
	};
}
