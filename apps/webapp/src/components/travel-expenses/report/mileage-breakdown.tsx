"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";
import type { MileageVehicle } from "@/lib/travel-expenses/mileage";
import { formatMoney, formatPlainDate } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The facts of a priced mileage item, live (calculated) or frozen (submitted). */
export interface MileageBreakdownFacts {
	distanceKm: string;
	ratePerKm: string;
	currency: string;
	exactAmount: string;
	amount: string;
	policy: { effectiveFrom: string; source: AllowancePolicySource };
}

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
function formatPrecise(locale: string, value: string, currency: string, maxDigits: number) {
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: maxDigits,
		}).format(Number(value));
	} catch {
		return `${value} ${currency}`;
	}
}

/** A rate per kilometre with up to its four stored decimals. */
export function formatRatePerKm(locale: string, rate: string, currency: string) {
	return formatPrecise(locale, rate, currency, 4);
}

function formatDistance(locale: string, distanceKm: string) {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(distanceKm));
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

/**
 * How a mileage amount was calculated: distance × the applied dated rate,
 * rounded once to cents, and which policy version supplied the rate.
 */
export function MileageBreakdown({ facts }: { facts: MileageBreakdownFacts }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const rounded = Number(facts.exactAmount) !== Number(facts.amount);
	return (
		<div className="space-y-1 text-sm">
			<p className="tabular-nums">
				{t(
					"travelExpenses.report.mileage.calculation",
					"{distance} km × {rate} per km = {amount}",
					{
						distance: formatDistance(locale, facts.distanceKm),
						rate: formatRatePerKm(locale, facts.ratePerKm, facts.currency),
						amount: formatMoney(locale, facts.amount, facts.currency),
					},
				)}
				{rounded && (
					<span className="text-muted-foreground">
						{" "}
						{t("travelExpenses.report.mileage.rounded", "(exactly {exact}, rounded to the cent)", {
							exact: formatPrecise(locale, facts.exactAmount, facts.currency, 6),
						})}
					</span>
				)}
			</p>
			<p className="text-muted-foreground">
				{t("travelExpenses.report.mileage.appliedPolicy", "Rate valid from {date} · {source}", {
					date: formatPlainDate(locale, facts.policy.effectiveFrom),
					source: policySourceLabel(t, facts.policy.source),
				})}
			</p>
		</div>
	);
}
