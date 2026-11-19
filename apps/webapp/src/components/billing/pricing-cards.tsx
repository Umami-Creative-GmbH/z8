"use client";

import { IconCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatEuroAmount, SEAT_PRICES_CENTS } from "@/lib/billing/seat-prices";
import { formatEuroCurrency } from "./format-euro-currency";

interface BillingPricingCardsProps {
	buttonLabels: { monthly: string; yearly: string };
	description?: string;
	isLoading: boolean;
	/** Whether kiosk seats are on (both kiosk prices configured); only then the kiosk seat price shows. */
	kioskSeatsEnabled?: boolean;
	onSubscribe: (interval: "month" | "year") => void;
	title?: string;
}

export function BillingPricingCards({
	buttonLabels,
	description,
	isLoading,
	kioskSeatsEnabled = false,
	onSubscribe,
	title,
}: BillingPricingCardsProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	// Formatted before translation so the yearly kiosk price reads "1.50" (or "1,50"), never "1.5".
	// For catalog strings that already carry the euro sign ("€{price}/seat/month").
	const amount = (cents: number) => formatEuroAmount(cents, locale);
	// The headline prices stand alone, so they carry the locale's own currency format.
	const currency = (cents: number) => formatEuroCurrency(cents, locale);
	const monthlyHeadingId = useId();
	const yearlyHeadingId = useId();

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{title ?? t("billing.choosePlan", "Choose Your Plan")}</h2>
				</CardTitle>
				<CardDescription>
					{description ??
						t(
							"billing.choosePlanDescription",
							"Start with a 14-day free trial. No credit card required to start.",
						)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-6 md:grid-cols-2">
					<section
						aria-labelledby={monthlyHeadingId}
						className="flex flex-col gap-4 rounded-lg border-2 p-5"
					>
						<div className="space-y-1.5">
							<h3 id={monthlyHeadingId} className="font-semibold leading-none">
								{t("billing.plans.monthly.title", "Monthly")}
							</h3>
							<p className="text-sm text-muted-foreground">
								{t("billing.plans.monthly.description", "Flexible month-to-month billing")}
							</p>
						</div>
						<div className="flex flex-1 flex-col gap-4">
							<div>
								<span className="text-4xl font-semibold tabular-nums">
									{currency(SEAT_PRICES_CENTS.full.month)}
								</span>
								<span className="text-muted-foreground">
									{t("billing.perSeatMonth", "/seat/month")}
								</span>
								{kioskSeatsEnabled ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"billing.kioskSeatPriceMonthly",
											"Kiosk seats (kiosk-only employees): €{price}/seat/month",
											{ price: amount(SEAT_PRICES_CENTS.kiosk.month) },
										)}
									</p>
								) : null}
							</div>
							<ul className="space-y-2 text-sm">
								<li className="flex items-center gap-2">
									<IconCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
									{t("billing.features.cancelAnytime", "Cancel anytime")}
								</li>
								<li className="flex items-center gap-2">
									<IconCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
									{t("billing.features.allFeatures", "All features included")}
								</li>
							</ul>
							<Button
								className="mt-auto w-full"
								variant="outline"
								onClick={() => onSubscribe("month")}
								disabled={isLoading}
							>
								{isLoading ? t("billing.starting", "Starting...") : buttonLabels.monthly}
							</Button>
						</div>
					</section>

					<section
						aria-labelledby={yearlyHeadingId}
						className="flex flex-col gap-4 rounded-lg border-2 border-primary p-5"
					>
						<div className="flex flex-wrap items-start justify-between gap-2">
							<div className="min-w-0 space-y-1.5">
								<h3 id={yearlyHeadingId} className="font-semibold leading-none">
									{t("billing.plans.yearly.title", "Yearly")}
								</h3>
								<p className="text-sm text-muted-foreground">
									{t("billing.plans.yearly.description", "Save 25% with annual billing")}
								</p>
							</div>
							<Badge>{t("billing.bestValue", "Best Value")}</Badge>
						</div>
						<div className="flex flex-1 flex-col gap-4">
							<div>
								<span className="text-4xl font-semibold tabular-nums">
									{currency(SEAT_PRICES_CENTS.full.yearPerMonth)}
								</span>
								<span className="text-muted-foreground">
									{t("billing.perSeatMonth", "/seat/month")}
								</span>
								<p className="text-sm text-muted-foreground">
									{t("billing.seatBilledAnnually", "€{price}/seat billed annually", {
										price: amount(SEAT_PRICES_CENTS.full.yearPerMonth * 12),
									})}
								</p>
								{kioskSeatsEnabled ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"billing.kioskSeatPriceYearly",
											"Kiosk seats (kiosk-only employees): €{price}/seat/month, €{total}/seat billed annually",
											{
												price: amount(SEAT_PRICES_CENTS.kiosk.yearPerMonth),
												total: amount(SEAT_PRICES_CENTS.kiosk.yearPerMonth * 12),
											},
										)}
									</p>
								) : null}
							</div>
							<ul className="space-y-2 text-sm">
								<li className="flex items-center gap-2">
									<IconCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
									{t("billing.features.yearlyDiscount", "25% discount vs monthly")}
								</li>
								<li className="flex items-center gap-2">
									<IconCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
									{t("billing.features.allFeatures", "All features included")}
								</li>
							</ul>
							<Button
								className="mt-auto w-full"
								onClick={() => onSubscribe("year")}
								disabled={isLoading}
							>
								{isLoading ? t("billing.starting", "Starting...") : buttonLabels.yearly}
							</Button>
						</div>
					</section>
				</div>
			</CardContent>
		</Card>
	);
}
