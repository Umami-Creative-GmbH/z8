"use client";

import { IconCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const MONTHLY_PRICE = 4;
export const YEARLY_PRICE_PER_MONTH = 3;
export const YEARLY_PRICE_TOTAL = 36;

interface BillingPricingCardsProps {
	buttonLabels: { monthly: string; yearly: string };
	description?: string;
	isLoading: boolean;
	onSubscribe: (interval: "month" | "year") => void;
	title?: string;
}

export function BillingPricingCards({
	buttonLabels,
	description,
	isLoading,
	onSubscribe,
	title,
}: BillingPricingCardsProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle>{title ?? t("billing.choosePlan", "Choose Your Plan")}</CardTitle>
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
					<Card className="border-2">
						<CardHeader>
							<CardTitle>{t("billing.plans.monthly.title", "Monthly")}</CardTitle>
							<CardDescription>
								{t("billing.plans.monthly.description", "Flexible month-to-month billing")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div>
								<span className="text-4xl font-bold">€{MONTHLY_PRICE}</span>
								<span className="text-muted-foreground">
									{t("billing.perSeatMonth", "/seat/month")}
								</span>
							</div>
							<ul className="space-y-2 text-sm">
								<li className="flex items-center gap-2">
									<IconCheck className="size-4 text-green-600" />
									{t("billing.features.cancelAnytime", "Cancel anytime")}
								</li>
								<li className="flex items-center gap-2">
									<IconCheck className="size-4 text-green-600" />
									{t("billing.features.allFeatures", "All features included")}
								</li>
							</ul>
							<Button
								className="w-full"
								variant="outline"
								onClick={() => onSubscribe("month")}
								disabled={isLoading}
							>
								{isLoading ? t("billing.starting", "Starting...") : buttonLabels.monthly}
							</Button>
						</CardContent>
					</Card>

					<Card className="border-2 border-primary">
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle>{t("billing.plans.yearly.title", "Yearly")}</CardTitle>
									<CardDescription>
										{t("billing.plans.yearly.description", "Save 25% with annual billing")}
									</CardDescription>
								</div>
								<Badge>{t("billing.bestValue", "Best Value")}</Badge>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div>
								<span className="text-4xl font-bold">€{YEARLY_PRICE_PER_MONTH}</span>
								<span className="text-muted-foreground">
									{t("billing.perSeatMonth", "/seat/month")}
								</span>
								<p className="text-sm text-muted-foreground">
									{t("billing.seatBilledAnnually", "€{price}/seat billed annually", {
										price: YEARLY_PRICE_TOTAL,
									})}
								</p>
							</div>
							<ul className="space-y-2 text-sm">
								<li className="flex items-center gap-2">
									<IconCheck className="size-4 text-green-600" />
									{t("billing.features.yearlyDiscount", "25% discount vs monthly")}
								</li>
								<li className="flex items-center gap-2">
									<IconCheck className="size-4 text-green-600" />
									{t("billing.features.allFeatures", "All features included")}
								</li>
							</ul>
							<Button
								className="w-full"
								onClick={() => onSubscribe("year")}
								disabled={isLoading}
							>
								{isLoading ? t("billing.starting", "Starting...") : buttonLabels.yearly}
							</Button>
						</CardContent>
					</Card>
				</div>
			</CardContent>
		</Card>
	);
}
