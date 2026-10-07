import type { useTranslate } from "@tolgee/react";
import type {
	PerDiemCalculation,
	PerDiemExceptionReason,
	PerDiemMeal,
	PerDiemRequirement,
} from "@/lib/travel-expenses/per-diem";
import { formatPlainDate } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

export function mealLabel(t: Translate, meal: PerDiemMeal) {
	switch (meal) {
		case "breakfast":
			return t("travelExpenses.report.perDiem.meals.breakfast", "Breakfast");
		case "lunch":
			return t("travelExpenses.report.perDiem.meals.lunch", "Lunch");
		case "dinner":
			return t("travelExpenses.report.perDiem.meals.dinner", "Dinner");
	}
}

export function perDiemExceptionLabel(t: Translate, reason: PerDiemExceptionReason) {
	switch (reason) {
		case "international":
			return t(
				"travelExpenses.report.perDiem.exceptions.international",
				"A destination is outside Germany. International per diem is not calculated yet.",
			);
		case "destination_not_listed":
			return t(
				"travelExpenses.report.perDiem.exceptions.destinationNotListed",
				"A daily location is not covered by the official foreign table or its fallback rules.",
			);
		case "special_location":
			return t(
				"travelExpenses.report.perDiem.exceptions.specialLocation",
				"A day was marked as a special situation (other, or a whole day in flight or at sea on the first or last travel day).",
			);
		case "foreign_without_overnight":
			return t(
				"travelExpenses.report.perDiem.exceptions.foreignWithoutOvernight",
				"An over-night activity abroad without an overnight stay is not calculated automatically.",
			);
		case "mixed_time_zones":
			return t(
				"travelExpenses.report.perDiem.exceptions.mixedTimeZones",
				"Departure and return are in different time zones.",
			);
		case "foreign_time_zone":
			return t(
				"travelExpenses.report.perDiem.exceptions.foreignTimeZone",
				"The travel times are not in German local time.",
			);
		case "nights_at_home":
			return t(
				"travelExpenses.report.perDiem.exceptions.nightsAtHome",
				"You spent some nights at home during the trip.",
			);
		case "multi_day_without_overnight":
			return t(
				"travelExpenses.report.perDiem.exceptions.multiDayWithoutOvernight",
				"The trip spans more than two calendar days without an overnight stay.",
			);
		case "prolonged_workplace":
			return t(
				"travelExpenses.report.perDiem.exceptions.prolongedWorkplace",
				"Longer activity at the same workplace: per diem is limited to the first three months.",
			);
		case "rules_not_verified":
			return t(
				"travelExpenses.report.perDiem.exceptions.rulesNotVerified",
				"No verified German rules cover these travel dates yet.",
			);
		case "majority_tie":
			return t(
				"travelExpenses.report.perDiem.exceptions.majorityTie",
				"The over-night absence is split exactly evenly between both days.",
			);
		case "overlapping_days":
			return t(
				"travelExpenses.report.perDiem.exceptions.overlappingDays",
				"Another of your reports already pays per diem for some of these days; only one allowance per day is allowed, so leave them out of the manual calculation.",
			);
	}
}

export function perDiemRequirementLabel(
	t: Translate,
	requirement: PerDiemRequirement,
	context: { locale: string; calculation: PerDiemCalculation | null; currency: string },
) {
	switch (requirement) {
		case "per_diem_start":
			return t(
				"travelExpenses.report.perDiem.requirements.start",
				"Enter when you left home or your workplace.",
			);
		case "per_diem_end":
			return t(
				"travelExpenses.report.perDiem.requirements.end",
				"Enter when you were back home or at your workplace.",
			);
		case "per_diem_overnight":
			return t(
				"travelExpenses.report.perDiem.requirements.overnight",
				"Tell us whether you stayed overnight away from home.",
			);
		case "per_diem_trip_dates":
			return t(
				"travelExpenses.report.perDiem.requirements.tripDates",
				"Your departure and return days must be the trip's first and last travel day.",
			);
		case "per_diem_meals":
			return t(
				"travelExpenses.report.perDiem.requirements.meals",
				"Confirm the provided meals for every travel day.",
			);
		case "per_diem_locations":
			return t(
				"travelExpenses.report.perDiem.requirements.locations",
				"Tell us for every travel day where you were at midnight and where your last business activity abroad was.",
			);
		case "per_diem_exceptional":
			return t(
				"travelExpenses.report.perDiem.requirements.exceptional",
				"This itinerary needs a manual per diem calculation by an expense administrator. It is not calculated automatically.",
			);
		case "per_diem_policy_missing": {
			const missing =
				context.calculation?.status === "policy_missing" ? context.calculation.dates : [];
			return t(
				"travelExpenses.report.perDiem.requirements.policyMissing",
				"Your organization has no per diem rates for {dates}. Ask an expense administrator to add dated rates in the travel expense settings. Nothing is calculated until then.",
				{ dates: missing.map((date) => formatPlainDate(context.locale, date)).join(", ") },
			);
		}
		case "per_diem_currency":
			return t(
				"travelExpenses.report.perDiem.requirements.currency",
				"The per diem rates for these days are in {policyCurrency}, but this report is reimbursed in {currency}. Ask an expense administrator to add rates in {currency}.",
				{
					policyCurrency:
						context.calculation?.status === "currency_mismatch"
							? context.calculation.policyCurrency
							: "",
					currency: context.currency,
				},
			);
		default:
			return requirement;
	}
}
