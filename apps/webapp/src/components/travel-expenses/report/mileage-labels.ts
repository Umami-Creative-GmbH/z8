import type { useTranslate } from "@tolgee/react";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";
import type {
	MileageCalculation,
	MileageItemRequirement,
	MileageVehicle,
} from "@/lib/travel-expenses/mileage";
import { formatPlainDate } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

export function vehicleLabel(t: Translate, vehicle: MileageVehicle | null) {
	switch (vehicle) {
		case "car":
			return t("travelExpenses.report.mileage.vehicles.car", "Car");
		case "other_motor_vehicle":
			return t(
				"travelExpenses.report.mileage.vehicles.otherMotorVehicle",
				"Other motor vehicle (e.g. motorcycle)",
			);
		default:
			return null;
	}
}

/** A precise decimal (rate per km, exact product) without money's rounding to cents. */
export function formatPrecise(locale: string, value: string, currency: string, maxDigits: number) {
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: maxDigits,
		}).format(value as Intl.StringNumericLiteral);
	} catch {
		return `${value} ${currency}`;
	}
}

/** A rate per kilometre with up to its four stored decimals. */
export function formatRatePerKm(locale: string, rate: string, currency: string) {
	return formatPrecise(locale, rate, currency, 4);
}

export function policySourceLabel(t: Translate, source: AllowancePolicySource) {
	if (source.kind === "statutory_default") {
		return t(
			"travelExpenses.report.mileage.sourceStatutory",
			"German statutory flat rate ({version})",
			{ version: source.version ?? "" },
		);
	}
	return source.reference
		? t("travelExpenses.report.mileage.sourceOrganization", "Organization policy: {reference}", {
				reference: source.reference,
			})
		: t("travelExpenses.report.mileage.sourceOrganizationUnnamed", "Organization policy");
}

export function mileageRequirementLabel(
	t: Translate,
	requirement: MileageItemRequirement,
	context: { locale: string; calculation: MileageCalculation | null; currency: string },
) {
	switch (requirement) {
		case "expense_date":
			return t("travelExpenses.report.mileage.requirements.date", "Enter the date of the drive.");
		case "route":
			return t("travelExpenses.report.mileage.requirements.route", "Describe the route.");
		case "distance":
			return t(
				"travelExpenses.report.mileage.requirements.distance",
				"Enter the kilometres driven.",
			);
		case "vehicle":
			return t("travelExpenses.report.mileage.requirements.vehicle", "Choose the vehicle.");
		case "mileage_policy_missing": {
			const missing = context.calculation?.status === "policy_missing" ? context.calculation : null;
			return t(
				"travelExpenses.report.mileage.requirements.policyMissing",
				"Your organization has no mileage rate for {vehicle} on {date}. Ask an expense administrator to add a dated rate in the travel expense settings. Nothing is calculated until then.",
				{
					vehicle: vehicleLabel(t, missing?.vehicle ?? null) ?? "",
					date: missing ? formatPlainDate(context.locale, missing.expenseDate) : "",
				},
			);
		}
		case "mileage_currency":
			return t(
				"travelExpenses.report.mileage.requirements.currency",
				"The mileage rate for this date is in {policyCurrency}, but this report is reimbursed in {currency}. Ask an expense administrator to add a rate in {currency}.",
				{
					policyCurrency:
						context.calculation?.status === "currency_mismatch"
							? context.calculation.policyCurrency
							: "",
					currency: context.currency,
				},
			);
	}
}
