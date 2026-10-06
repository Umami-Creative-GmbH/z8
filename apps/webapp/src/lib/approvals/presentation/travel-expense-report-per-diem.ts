import type { PerDiemDayBreakdown, PerDiemDayLocation } from "@/lib/travel-expenses/per-diem";
import type { PerDiemDestinationRule } from "@/lib/travel-expenses/per-diem-location";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

const BASIS: Record<PerDiemDayBreakdown["basis"], string> = {
	absence_24h: "24 hours away",
	travel_day_with_overnight: "travel day with overnight stay",
	absence_over_8h: "more than 8 hours away",
	absence_8h_or_less: "8 hours or less away",
	overnight_majority: "most of an over-night absence",
	overnight_minority: "counted on the other day",
};

const MEAL_LABELS = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner" } as const;

function minutes(value: number): string {
	return `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min`;
}

const FALLBACK: Partial<Record<PerDiemDestinationRule, string>> = {
	luxembourg: "official fallback, unlisted state",
	mother_country: "official fallback, territory of the mother country",
	flight_austria: "official fallback, whole day in flight",
	ship_luxembourg: "official fallback, whole day at sea",
	assigned: "amounts the notice assigns",
};

/** The day's location (#611): the applied official entry, and why when it is not the entered place. */
function locationText(location: PerDiemDayLocation): string {
	const why = FALLBACK[location.rule];
	if (!why) return location.label;
	const entered =
		"special" in location.entered ? location.entered.special : location.entered.country;
	return `${location.label} (${entered}: ${why})`;
}

/** One line per calendar day: location, basis, rate, provided meals with deductions, amount. */
function dayLine(day: PerDiemDayBreakdown, currency: string): string {
	const meals = (Object.keys(MEAL_LABELS) as (keyof typeof MEAL_LABELS)[])
		.filter((meal) => day.meals[meal].provided)
		.map((meal) => {
			const entry = day.meals[meal];
			const paid = entry.employeePayment ? `, paid ${entry.employeePayment}` : "";
			return `${MEAL_LABELS[meal]} provided${paid} (−${entry.deduction})`;
		});
	return [
		...(day.location ? [locationText(day.location)] : []),
		`${BASIS[day.basis]} (${minutes(day.absenceMinutes)})`,
		`${day.rate}${meals.length > 0 ? ` − ${day.deductions} [${meals.join("; ")}]` : ""} = ${day.amount} ${currency}`,
	].join(" — ");
}

/**
 * Review rows of a frozen per diem item (#609): the entered travel times with
 * their zones, the daily breakdown, the rule edition and the policy versions.
 * Read from the frozen facts only; today's policy is never consulted.
 */
export function perDiemReviewRows(item: TravelExpenseReportSubmittedItem): Row[] {
	const { perDiem } = item;
	if (!perDiem) return [];
	const overnight =
		perDiem.overnight === null
			? text("perDiemSingleDay", "Single-day trip")
			: perDiem.overnight === "away"
				? text("perDiemOvernightAway", "Overnight stays away from home")
				: text("perDiemOvernightNone", "No overnight stay");
	return [
		{
			label: text("perDiemDeparture", "Left home or workplace"),
			value: `${perDiem.start.date} ${perDiem.start.time} (${perDiem.start.timeZone})`,
		},
		{
			label: text("perDiemReturn", "Back home or at workplace"),
			value: `${perDiem.end.date} ${perDiem.end.time} (${perDiem.end.timeZone})`,
		},
		{ label: text("perDiemOvernight", "Overnight"), value: overnight },
		// One row per calendar day, labelled with its logical date.
		...perDiem.days.map((day): Row => ({ label: day.date, value: dayLine(day, perDiem.currency) })),
		{
			label: text("perDiemTotal", "Per diem"),
			value: `${perDiem.amount} ${perDiem.currency}`,
		},
		{
			label: text("perDiemRules", "Rules applied"),
			value: `${perDiem.rules.reference} (${perDiem.rules.version})`,
		},
		// #611: the BMF table edition that priced days abroad.
		...(perDiem.rules.foreignTable
			? [
					{
						label: text("perDiemForeignRates", "Foreign rates"),
						value: `${perDiem.rules.foreignTable.reference} (${perDiem.rules.foreignTable.version})`,
					},
				]
			: []),
		{
			label: text("perDiemPolicy", "Applied rates"),
			value: perDiem.policies
				.map((policy) => {
					const source =
						policy.source.kind === "statutory_default"
							? `statutory default: ${policy.source.reference ?? ""} (${policy.source.version ?? ""})`
							: `organization policy${policy.source.reference ? `: ${policy.source.reference}` : ""}`;
					const area = policy.area === "DE" ? "" : ` (${policy.area})`;
					return `Version ${policy.versionId}${area}, valid from ${policy.effectiveFrom}: full day ${policy.rates.fullDay}, partial day ${policy.rates.partialDay}, breakfast −${policy.rates.breakfastDeduction}, lunch −${policy.rates.lunchDeduction}, dinner −${policy.rates.dinnerDeduction} ${perDiem.currency} (${source})`;
				})
				.join("; "),
		},
	];
}
