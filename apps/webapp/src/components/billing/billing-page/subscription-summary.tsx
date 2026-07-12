import { IconCalendar, IconCreditCard, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MONTHLY_PRICE, YEARLY_PRICE_PER_MONTH, YEARLY_PRICE_TOTAL } from "../pricing-cards";
import type { SubscriptionInfo } from "./types";

interface SubscriptionSummaryProps {
	canManageBilling: boolean;
	isPortalLoading: boolean;
	onManageBilling: () => void;
	subscription: SubscriptionInfo;
}

export function SubscriptionSummary({
	canManageBilling,
	isPortalLoading,
	onManageBilling,
	subscription,
}: SubscriptionSummaryProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const formatDate = (dateStr: string | null) => {
		if (!dateStr) return t("common:common.notApplicable", "N/A");
		return DateTime.fromISO(dateStr, { zone: "utc" }).setLocale(locale).toLocaleString(DateTime.DATE_MED);
	};
	const getTrialDaysRemaining = () => {
		if (!subscription.trialEnd) return 0;
		return Math.max(0, Math.ceil(DateTime.fromISO(subscription.trialEnd).diff(DateTime.now(), "days").days));
	};
	const statusBadge = (() => {
		switch (subscription.status) {
			case "trialing":
				return <Badge variant="default">{t("billing.status.trial", "Trial")}</Badge>;
			case "active":
				return (
					<Badge variant="default" className="bg-green-600">
						{t("common:common.active", "Active")}
					</Badge>
				);
			case "past_due":
				return <Badge variant="destructive">{t("billing.status.pastDue", "Past Due")}</Badge>;
			case "canceled":
				return <Badge variant="secondary">{t("billing.status.canceled", "Canceled")}</Badge>;
			default:
				return <Badge variant="outline">{subscription.status}</Badge>;
		}
	})();

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							{t("billing.currentPlan", "Current Plan")} {statusBadge}
						</CardTitle>
						<CardDescription>
							{subscription.billingInterval === "year"
								? t("billing.interval.yearlyBilling", "Yearly billing")
								: t("billing.interval.monthlyBilling", "Monthly billing")}
						</CardDescription>
					</div>
					{canManageBilling ? (
						<Button variant="outline" onClick={onManageBilling} disabled={isPortalLoading}>
							{isPortalLoading
								? t("billing.opening", "Opening...")
								: t("billing.manageBilling", "Manage Billing")}
						</Button>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				<div className="grid gap-6 md:grid-cols-3">
					<div className="flex items-start gap-3">
						<div className="rounded-lg bg-primary/10 p-2">
							<IconUsers className="size-5 text-primary" />
						</div>
						<div>
							<p className="text-sm text-muted-foreground">{t("billing.activeSeats", "Active Seats")}</p>
							<p className="text-2xl font-bold">{subscription.currentSeats}</p>
							<p className="text-xs text-muted-foreground">
								{subscription.billingInterval === "year"
									? t("billing.priceSeatMonthYearly", "€{price}/seat/mo (billed yearly)", {
											price: YEARLY_PRICE_PER_MONTH,
										})
									: t("billing.priceSeatMonth", "€{price}/seat/mo", { price: MONTHLY_PRICE })}
							</p>
						</div>
					</div>
					<div className="flex items-start gap-3">
						<div className="rounded-lg bg-primary/10 p-2">
							<IconCalendar className="size-5 text-primary" />
						</div>
						<div>
							{subscription.isTrialing ? (
								<>
									<p className="text-sm text-muted-foreground">{t("billing.trialEnds", "Trial Ends")}</p>
									<p className="text-2xl font-bold">
										{t("billing.days", "{count} days", { count: getTrialDaysRemaining() })}
									</p>
									<p className="text-xs text-muted-foreground">{formatDate(subscription.trialEnd)}</p>
								</>
							) : (
								<>
									<p className="text-sm text-muted-foreground">{t("billing.nextBilling", "Next Billing")}</p>
									<p className="text-2xl font-bold">{formatDate(subscription.currentPeriodEnd)}</p>
									{subscription.cancelAt ? (
										<p className="text-xs text-destructive">
											{t("billing.cancelsOn", "Cancels on {date}", {
												date: formatDate(subscription.cancelAt),
											})}
										</p>
									) : null}
								</>
							)}
						</div>
					</div>
					<div className="flex items-start gap-3">
						<div className="rounded-lg bg-primary/10 p-2">
							<IconCreditCard className="size-5 text-primary" />
						</div>
						<div>
							<p className="text-sm text-muted-foreground">{t("billing.monthlyCost", "Monthly Cost")}</p>
							<p className="text-2xl font-bold">
								€
								{subscription.billingInterval === "year"
									? (subscription.currentSeats * YEARLY_PRICE_PER_MONTH).toFixed(2)
									: (subscription.currentSeats * MONTHLY_PRICE).toFixed(2)}
							</p>
							<p className="text-xs text-muted-foreground">
								{subscription.billingInterval === "year"
									? t("billing.yearTotal", "€{amount}/year total", {
											amount: (subscription.currentSeats * YEARLY_PRICE_TOTAL).toFixed(2),
										})
									: t("billing.billedMonthly", "billed monthly")}
							</p>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
