import type { PerDiemDayBreakdown, PerDiemDayLocation } from "@/lib/travel-expenses/per-diem";
import type { PerDiemDestinationRule } from "@/lib/travel-expenses/per-diem-location";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (
	key: string,
	fallback: string,
	params?: ApprovalInboxLocalizedText["params"],
): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
	...(params ? { params } : {}),
});

const BASIS: Record<PerDiemDayBreakdown["basis"], ApprovalInboxLocalizedText> = {
	absence_24h: text("perDiemBasis.absence24h", "24 hours away"),
	travel_day_with_overnight: text(
		"perDiemBasis.travelDayWithOvernight",
		"travel day with overnight stay",
	),
	absence_over_8h: text("perDiemBasis.absenceOver8h", "more than 8 hours away"),
	absence_8h_or_less: text("perDiemBasis.absence8hOrLess", "8 hours or less away"),
	overnight_majority: text("perDiemBasis.overnightMajority", "most of an over-night absence"),
	overnight_minority: text("perDiemBasis.overnightMinority", "counted on the other day"),
	claimed_in_other_report: text(
		"perDiemBasis.claimedInOtherReport",
		"already paid in another report (one allowance per day)",
	),
};

const MEALS = {
	breakfast: text("perDiemMeal.breakfast", "breakfast"),
	lunch: text("perDiemMeal.lunch", "lunch"),
	dinner: text("perDiemMeal.dinner", "dinner"),
} as const;

function duration(value: number): ApprovalInboxLocalizedText {
	return text("perDiemDuration", "{hours} h {minutes} min", {
		hours: Math.floor(value / 60),
		minutes: String(value % 60).padStart(2, "0"),
	});
}

const FALLBACK: Partial<Record<PerDiemDestinationRule, ApprovalInboxLocalizedText>> = {
	luxembourg: text("perDiemFallback.luxembourg", "official fallback, unlisted state"),
	mother_country: text(
		"perDiemFallback.motherCountry",
		"official fallback, territory of the mother country",
	),
	flight_austria: text("perDiemFallback.flightAustria", "official fallback, whole day in flight"),
	ship_luxembourg: text("perDiemFallback.shipLuxembourg", "official fallback, whole day at sea"),
	assigned: text("perDiemFallback.assigned", "amounts the notice assigns"),
};

/** The day's location (#611): the applied official entry, and why when it is not the entered place. */
function locationText(location: PerDiemDayLocation): ApprovalInboxLocalizedText {
	const why = FALLBACK[location.rule];
	if (!why) return text("perDiemLocation", "{label}", { label: location.label });
	const entered =
		"special" in location.entered ? location.entered.special : location.entered.country;
	return text("perDiemLocationFallback", "{label} ({entered}: {why})", {
		label: location.label,
		entered,
		why,
	});
}

/** One line per calendar day: location, basis, rate, provided meals with deductions, amount. */
function dayLine(day: PerDiemDayBreakdown, currency: string): ApprovalInboxLocalizedText {
	const meals = (Object.keys(MEALS) as (keyof typeof MEALS)[])
		.filter((meal) => day.meals[meal].provided)
		.map((meal) => {
			const entry = day.meals[meal];
			return entry.employeePayment
				? text("perDiemMealProvidedPaid", "{meal} provided, paid {payment} (−{deduction})", {
						meal: MEALS[meal],
						payment: entry.employeePayment,
						deduction: entry.deduction,
					})
				: text("perDiemMealProvided", "{meal} provided (−{deduction})", {
						meal: MEALS[meal],
						deduction: entry.deduction,
					});
		});
	const amount =
		meals.length > 0
			? text("perDiemDayAmountWithMeals", "{rate} − {deductions} [{meals}] = {amount} {currency}", {
					rate: day.rate,
					deductions: day.deductions,
					meals,
					amount: day.amount,
					currency,
				})
			: text("perDiemDayAmount", "{rate} = {amount} {currency}", {
					rate: day.rate,
					amount: day.amount,
					currency,
				});
	const basis = text("perDiemDayBasis", "{basis} ({duration})", {
		basis: BASIS[day.basis],
		duration: duration(day.absenceMinutes),
	});
	return day.location
		? text("perDiemDayLineWithLocation", "{location} — {basis} — {amount}", {
				location: locationText(day.location),
				basis,
				amount,
			})
		: text("perDiemDayLine", "{basis} — {amount}", { basis, amount });
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
			value: text("perDiemPolicies", "{policies}", {
				policies: perDiem.policies.map((policy) =>
					text(
						"perDiemPolicyLine",
						"Version {version}{area}, valid from {from}: full day {fullDay}, partial day {partialDay}, breakfast −{breakfast}, lunch −{lunch}, dinner −{dinner} {currency} ({source})",
						{
							version: policy.versionId,
							area: policy.area === "DE" ? "" : ` (${policy.area})`,
							from: policy.effectiveFrom,
							fullDay: policy.rates.fullDay,
							partialDay: policy.rates.partialDay,
							breakfast: policy.rates.breakfastDeduction,
							lunch: policy.rates.lunchDeduction,
							dinner: policy.rates.dinnerDeduction,
							currency: perDiem.currency,
							source:
								policy.source.kind === "statutory_default"
									? text("perDiemPolicyStatutory", "statutory default: {reference} ({edition})", {
											reference: policy.source.reference ?? "",
											edition: policy.source.version ?? "",
										})
									: policy.source.reference
										? text("perDiemPolicyOrganizationNamed", "organization policy: {reference}", {
												reference: policy.source.reference,
											})
										: text("perDiemPolicyOrganization", "organization policy"),
						},
					),
				),
			}),
		},
	];
}
