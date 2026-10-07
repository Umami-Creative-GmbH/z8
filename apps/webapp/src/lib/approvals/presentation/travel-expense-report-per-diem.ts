import type { PerDiemDayBreakdown, PerDiemDayLocation } from "@/lib/travel-expenses/per-diem";
import type { PerDiemDestinationRule } from "@/lib/travel-expenses/per-diem-location";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type {
	ApprovalInboxDetailSection,
	ApprovalInboxLocalizedText,
	ApprovalInboxTextParam,
} from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (
	key: string,
	fallback: string,
	params?: ApprovalInboxLocalizedText["params"],
): ApprovalInboxLocalizedText => ({
	key,
	fallback,
	...(params ? { params } : {}),
});

const BASIS: Record<PerDiemDayBreakdown["basis"], ApprovalInboxLocalizedText> = {
	absence_24h: text("approvals:approvals.evidence.perDiemBasis.absence24h", "24 hours away"),
	travel_day_with_overnight: text(
		"approvals:approvals.evidence.perDiemBasis.travelDayWithOvernight",
		"travel day with overnight stay",
	),
	absence_over_8h: text(
		"approvals:approvals.evidence.perDiemBasis.absenceOver8h",
		"more than 8 hours away",
	),
	absence_8h_or_less: text(
		"approvals:approvals.evidence.perDiemBasis.absence8hOrLess",
		"8 hours or less away",
	),
	overnight_majority: text(
		"approvals:approvals.evidence.perDiemBasis.overnightMajority",
		"most of an over-night absence",
	),
	overnight_minority: text(
		"approvals:approvals.evidence.perDiemBasis.overnightMinority",
		"counted on the other day",
	),
	claimed_in_other_report: text(
		"approvals:approvals.evidence.perDiemBasis.claimedInOtherReport",
		"already paid in another report (one allowance per day)",
	),
};

const MEALS = {
	breakfast: text("approvals:approvals.evidence.perDiemMeal.breakfast", "breakfast"),
	lunch: text("approvals:approvals.evidence.perDiemMeal.lunch", "lunch"),
	dinner: text("approvals:approvals.evidence.perDiemMeal.dinner", "dinner"),
} as const;

function duration(value: number): ApprovalInboxLocalizedText {
	return text("approvals:approvals.evidence.perDiemDuration", "{hours} h {minutes} min", {
		hours: Math.floor(value / 60),
		minutes: String(value % 60).padStart(2, "0"),
	});
}

const FALLBACK: Partial<Record<PerDiemDestinationRule, ApprovalInboxLocalizedText>> = {
	luxembourg: text(
		"approvals:approvals.evidence.perDiemFallback.luxembourg",
		"official fallback, unlisted state",
	),
	mother_country: text(
		"approvals:approvals.evidence.perDiemFallback.motherCountry",
		"official fallback, territory of the mother country",
	),
	flight_austria: text(
		"approvals:approvals.evidence.perDiemFallback.flightAustria",
		"official fallback, whole day in flight",
	),
	ship_luxembourg: text(
		"approvals:approvals.evidence.perDiemFallback.shipLuxembourg",
		"official fallback, whole day at sea",
	),
	assigned: text(
		"approvals:approvals.evidence.perDiemFallback.assigned",
		"amounts the notice assigns",
	),
};

/** The day's location (#611): the applied official entry, and why when it is not the entered place. */
function locationText(location: PerDiemDayLocation): ApprovalInboxLocalizedText {
	const why = FALLBACK[location.rule];
	if (!why)
		return text("approvals:approvals.evidence.perDiemLocation", "{label}", {
			label: location.label,
		});
	const entered: ApprovalInboxTextParam =
		"special" in location.entered
			? location.entered.special
			: { kind: "country", code: location.entered.country };
	return text(
		"approvals:approvals.evidence.perDiemLocationFallback",
		"{label} ({entered}: {why})",
		{
			label: location.label,
			entered,
			why,
		},
	);
}

/** One line per calendar day: location, basis, rate, provided meals with deductions, amount. */
function dayLine(day: PerDiemDayBreakdown, currency: string): ApprovalInboxLocalizedText {
	const meals = (Object.keys(MEALS) as (keyof typeof MEALS)[])
		.filter((meal) => day.meals[meal].provided)
		.map((meal) => {
			const entry = day.meals[meal];
			return entry.employeePayment
				? text(
						"approvals:approvals.evidence.perDiemMealProvidedPaid",
						"{meal} provided, paid {payment} (−{deduction})",
						{
							meal: MEALS[meal],
							payment: entry.employeePayment,
							deduction: entry.deduction,
						},
					)
				: text(
						"approvals:approvals.evidence.perDiemMealProvided",
						"{meal} provided (−{deduction})",
						{
							meal: MEALS[meal],
							deduction: entry.deduction,
						},
					);
		});
	const amount =
		meals.length > 0
			? text(
					"approvals:approvals.evidence.perDiemDayAmountWithMeals",
					"{rate} − {deductions} [{meals}] = {amount} {currency}",
					{
						rate: day.rate,
						deductions: day.deductions,
						meals,
						amount: day.amount,
						currency,
					},
				)
			: text("approvals:approvals.evidence.perDiemDayAmount", "{rate} = {amount} {currency}", {
					rate: day.rate,
					amount: day.amount,
					currency,
				});
	const basis = text("approvals:approvals.evidence.perDiemDayBasis", "{basis} ({duration})", {
		basis: BASIS[day.basis],
		duration: duration(day.absenceMinutes),
	});
	return day.location
		? text(
				"approvals:approvals.evidence.perDiemDayLineWithLocation",
				"{location} — {basis} — {amount}",
				{
					location: locationText(day.location),
					basis,
					amount,
				},
			)
		: text("approvals:approvals.evidence.perDiemDayLine", "{basis} — {amount}", { basis, amount });
}

/** An entered local time: its calendar day in the viewer's format, the wall time and zone as entered. */
function enteredTime(at: {
	date: string;
	time: string;
	timeZone: string;
}): ApprovalInboxLocalizedText {
	return text("approvals:approvals.evidence.perDiemEnteredTime", "{date} {time} ({zone})", {
		date: { kind: "plain_date", date: at.date },
		time: at.time,
		zone: at.timeZone,
	});
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
			? text("approvals:approvals.evidence.perDiemSingleDay", "Single-day trip")
			: perDiem.overnight === "away"
				? text(
						"approvals:approvals.evidence.perDiemOvernightAway",
						"Overnight stays away from home",
					)
				: text("approvals:approvals.evidence.perDiemOvernightNone", "No overnight stay");
	return [
		{
			label: text("approvals:approvals.evidence.perDiemDeparture", "Left home or workplace"),
			value: enteredTime(perDiem.start),
		},
		{
			label: text("approvals:approvals.evidence.perDiemReturn", "Back home or at workplace"),
			value: enteredTime(perDiem.end),
		},
		{ label: text("approvals:approvals.evidence.perDiemOvernight", "Overnight"), value: overnight },
		// One row per calendar day, labelled with its logical date.
		...perDiem.days.map(
			(day): Row => ({
				label: text("approvals:approvals.evidence.perDiemDayDate", "{date}", {
					date: { kind: "plain_date", date: day.date },
				}),
				value: dayLine(day, perDiem.currency),
			}),
		),
		{
			label: text("approvals:approvals.evidence.perDiemTotal", "Per diem"),
			value: { kind: "money", amount: perDiem.amount, currency: perDiem.currency },
		},
		{
			label: text("approvals:approvals.evidence.perDiemRules", "Rules applied"),
			value: `${perDiem.rules.reference} (${perDiem.rules.version})`,
		},
		// #611: the BMF table edition that priced days abroad.
		...(perDiem.rules.foreignTable
			? [
					{
						label: text("approvals:approvals.evidence.perDiemForeignRates", "Foreign rates"),
						value: `${perDiem.rules.foreignTable.reference} (${perDiem.rules.foreignTable.version})`,
					},
				]
			: []),
		{
			label: text("approvals:approvals.evidence.perDiemPolicy", "Applied rates"),
			value: text("approvals:approvals.evidence.perDiemPolicies", "{policies}", {
				policies: perDiem.policies.map((policy) =>
					text(
						"approvals:approvals.evidence.perDiemPolicyLine",
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
									? text(
											"approvals:approvals.evidence.perDiemPolicyStatutory",
											"statutory default: {reference} ({edition})",
											{
												reference: policy.source.reference ?? "",
												edition: policy.source.version ?? "",
											},
										)
									: policy.source.reference
										? text(
												"approvals:approvals.evidence.perDiemPolicyOrganizationNamed",
												"organization policy: {reference}",
												{
													reference: policy.source.reference,
												},
											)
										: text(
												"approvals:approvals.evidence.perDiemPolicyOrganization",
												"organization policy",
											),
						},
					),
				),
			}),
		},
	];
}
