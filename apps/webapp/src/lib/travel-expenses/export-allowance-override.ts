import { ALLOWANCE_OVERRIDE_FACTS_SCHEMA_VERSION } from "@/lib/approvals/evidence/travel-expense-report-allowance-override";
import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "@/lib/approvals/evidence/travel-expense-report-facts";

/**
 * Export columns of an audited allowance override (#610, v9+). An overridden
 * mileage or per diem item counts the administrator's amount; the CSV names
 * the override, the situation it resolved, its reason, evidence and
 * calculation basis, the authorizer, and the entered facts it was authorized
 * for (local travel times as entered, never shifted through a zone). The
 * ordinary policy result, when one was frozen, stays in the mileage or per
 * diem columns.
 */

export const ALLOWANCE_OVERRIDE_COLUMNS = [
	"allowance_override_id",
	"allowance_override_situation",
	"allowance_override_reasons",
	"allowance_override_amount",
	"allowance_override_currency",
	"allowance_override_reason",
	"allowance_override_evidence",
	"allowance_override_calculation_basis",
	"allowance_override_authorized_by_employee_id",
	"allowance_override_authorized_by_name",
	"allowance_override_authorized_at",
	"allowance_override_route",
	"allowance_override_distance_km",
	"allowance_override_vehicle",
	"allowance_override_start",
	"allowance_override_end",
] as const;

type Cells = {
	text: (value: string | null | undefined) => string;
	decimal: (value: string) => string;
	plainDecimal: (value: string | null | undefined) => string;
};

export function allowanceOverrideCells(item: TravelExpenseReportSubmittedItem, cells: Cells) {
	const override = item.allowanceOverride;
	if (!override) return ALLOWANCE_OVERRIDE_COLUMNS.map(() => "");
	const { scope } = override;
	const mileage = scope.kind === "mileage" ? scope : null;
	const itinerary = scope.kind === "per_diem" ? scope.itinerary : null;
	const local = (date: string | null, time: string | null, zone: string | null) =>
		date ? [date, time, zone].filter(Boolean).join(" ") : null;
	return [
		cells.text(override.overrideId),
		cells.text(override.situation.kind),
		cells.text(override.situation.reasons.join("; ")),
		cells.decimal(override.amount),
		cells.text(override.currency),
		cells.text(override.reason),
		cells.text(override.evidence),
		cells.text(override.calculationBasis),
		cells.text(override.authorizedBy.employeeId),
		cells.text(override.authorizedBy.name),
		cells.text(override.authorizedAt),
		mileage ? cells.text(mileage.route) : "",
		cells.plainDecimal(mileage?.distanceKm),
		mileage ? cells.text(mileage.vehicle) : "",
		itinerary
			? cells.text(local(itinerary.startDate, itinerary.startTime, itinerary.startTimeZone))
			: "",
		itinerary ? cells.text(local(itinerary.endDate, itinerary.endTime, itinerary.endTimeZone)) : "",
	];
}

/** Whether an override's frozen amount is what the item and its totals counted. */
export function allowanceOverrideMatchesItem(
	item: TravelExpenseReportSubmittedItem,
	currency: string,
): boolean {
	const override = item.allowanceOverride;
	if (!override) return true;
	return (
		override.kind === item.type &&
		override.scope.kind === item.type &&
		override.currency === currency &&
		item.original.amount === override.amount &&
		item.original.currency === currency
	);
}

/** An override frozen below the version that admits it is refused. */
export function allowanceOverrideManifestProblem(
	facts: TravelExpenseReportSubmittedFacts,
): string | null {
	if (
		facts.schemaVersion < ALLOWANCE_OVERRIDE_FACTS_SCHEMA_VERSION &&
		facts.items.some((item) => item.allowanceOverride)
	) {
		return `Allowance override in facts schema version ${facts.schemaVersion}`;
	}
	return null;
}
