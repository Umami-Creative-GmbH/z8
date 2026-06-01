"use client";

import {
	IconAlertTriangle,
	IconCalendar,
	IconCheck,
	IconCreditCard,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SubscriptionInfo {
	id: string;
	hasStripeCustomer: boolean;
	status: string;
	isActive: boolean;
	isTrialing: boolean;
	isPastDue: boolean;
	currentSeats: number;
	trialEnd: string | null;
	currentPeriodEnd: string | null;
	billingInterval: string | null;
	cancelAt: string | null;
}

interface AccessResult {
	canAccess: boolean;
	reason?: string;
	trialEndsAt?: string | null;
	status?: string;
}

interface BillingPageClientProps {
	subscription: SubscriptionInfo | null;
	accessResult: AccessResult;
	isOwner: boolean;
}

// Pricing
const MONTHLY_PRICE = 4;
const YEARLY_PRICE_PER_MONTH = 3;
const YEARLY_PRICE_TOTAL = 36;

function BillingPageClientContent({ subscription, accessResult, isOwner }: BillingPageClientProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const searchParams = useSearchParams();
	const { get } = searchParams;
	const getSearchParam = (key: string) => get.call(searchParams, key);
	const [isLoading, setIsLoading] = useState(false);
	const [isPortalLoading, setIsPortalLoading] = useState(false);

	// Handle success/cancel redirects from Stripe
	const success = getSearchParam("success");
	const canceled = getSearchParam("canceled");
	const canManageBilling = Boolean(subscription?.hasStripeCustomer);

	const handleSubscribe = async (interval: "month" | "year") => {
		setIsLoading(true);
		const response = await fetch("/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ interval }),
		}).catch(() => null);

		if (!response) {
			toast.error(t("billing.checkoutStartFailed", "Failed to start checkout"));
			setIsLoading(false);
			return;
		}

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			toast.error(
				data?.error || t("billing.checkoutCreateFailed", "Failed to create checkout session"),
			);
			setIsLoading(false);
			return;
		}

		if (!data?.url) {
			toast.error(t("billing.checkoutStartFailed", "Failed to start checkout"));
			setIsLoading(false);
			return;
		}

		// Redirect to Stripe Checkout
		window.location.href = data.url;
	};

	const handleManageBilling = async () => {
		setIsPortalLoading(true);
		const response = await fetch("/api/billing/portal", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ returnUrl: window.location.href }),
		}).catch(() => null);

		if (!response) {
			toast.error(t("billing.portalOpenFailed", "Failed to open billing portal"));
			setIsPortalLoading(false);
			return;
		}

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			toast.error(data?.error || t("billing.portalOpenFailed", "Failed to open billing portal"));
			setIsPortalLoading(false);
			return;
		}

		if (!data?.url) {
			toast.error(t("billing.portalOpenFailed", "Failed to open billing portal"));
			setIsPortalLoading(false);
			return;
		}

		// Redirect to Stripe Portal
		window.location.href = data.url;
	};

	const formatDate = (dateStr: string | null) => {
		if (!dateStr) return t("common:common.notApplicable", "N/A");
		return DateTime.fromISO(dateStr, { zone: "utc" })
			.setLocale(locale)
			.toLocaleString(DateTime.DATE_MED);
	};

	const getTrialDaysRemaining = () => {
		if (!subscription?.trialEnd) return 0;
		const trialEnd = DateTime.fromISO(subscription.trialEnd);
		const now = DateTime.now();
		return Math.max(0, Math.ceil(trialEnd.diff(now, "days").days));
	};

	const getStatusBadge = () => {
		if (!subscription) {
			return (
				<Badge variant="outline">{t("billing.status.noSubscription", "No Subscription")}</Badge>
			);
		}

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
	};

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			{/* Success/Cancel Alerts */}
			{success && (
				<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
					<IconCheck className="size-4 text-green-600" />
					<AlertTitle>{t("billing.alerts.successTitle", "Success!")}</AlertTitle>
					<AlertDescription>
						{t(
							"billing.alerts.successDescription",
							"Your subscription has been activated. Thank you for subscribing!",
						)}
					</AlertDescription>
				</Alert>
			)}

			{canceled && (
				<Alert>
					<AlertDescription>
						{t(
							"billing.alerts.canceledDescription",
							"Checkout was canceled. You can try again whenever you're ready.",
						)}
					</AlertDescription>
				</Alert>
			)}

			{/* Warning Alert for access issues */}
			{!accessResult.canAccess && (
				<Alert variant="destructive">
					<IconAlertTriangle className="size-4" />
					<AlertTitle>
						{t("billing.alerts.subscriptionRequired", "Subscription Required")}
					</AlertTitle>
					<AlertDescription>
						{accessResult.reason === "trial_expired"
							? t(
									"billing.access.trialExpired",
									"Your trial has expired. Subscribe to continue using the app.",
								)
							: accessResult.reason === "payment_failed"
								? t(
										"billing.access.paymentFailed",
										"Your last payment failed. Please update your payment method.",
									)
								: accessResult.reason === "canceled"
									? t(
											"billing.access.canceled",
											"Your subscription has been canceled. Resubscribe to regain access.",
										)
									: t(
											"billing.access.required",
											"A subscription is required to use this application.",
										)}
					</AlertDescription>
				</Alert>
			)}

			<div>
				<h1 className="text-3xl font-bold">{t("billing.title", "Billing & Subscription")}</h1>
				<p className="text-muted-foreground mt-1">
					{t("billing.description", "Manage your subscription and billing details")}
				</p>
			</div>

			{/* Current Subscription Card */}
			{subscription ? (
				<>
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle className="flex items-center gap-2">
										{t("billing.currentPlan", "Current Plan")} {getStatusBadge()}
									</CardTitle>
									<CardDescription>
										{subscription.billingInterval === "year"
											? t("billing.interval.yearlyBilling", "Yearly billing")
											: t("billing.interval.monthlyBilling", "Monthly billing")}
									</CardDescription>
								</div>
								{canManageBilling ? (
									<Button variant="outline" onClick={handleManageBilling} disabled={isPortalLoading}>
										{isPortalLoading
											? t("billing.opening", "Opening...")
											: t("billing.manageBilling", "Manage Billing")}
									</Button>
								) : (
									<div className="flex flex-wrap gap-2">
										<Button variant="outline" onClick={() => handleSubscribe("month")} disabled={isLoading}>
											{isLoading
												? t("billing.starting", "Starting...")
												: t("billing.upgradeMonthly", "Upgrade Monthly")}
										</Button>
										<Button onClick={() => handleSubscribe("year")} disabled={isLoading}>
											{isLoading
												? t("billing.starting", "Starting...")
												: t("billing.upgradeYearly", "Upgrade Yearly")}
										</Button>
									</div>
								)}
							</div>
						</CardHeader>
						<CardContent>
							<div className="grid gap-6 md:grid-cols-3">
								{/* Seats */}
								<div className="flex items-start gap-3">
									<div className="p-2 bg-primary/10 rounded-lg">
										<IconUsers className="size-5 text-primary" />
									</div>
									<div>
										<p className="text-sm text-muted-foreground">
											{t("billing.activeSeats", "Active Seats")}
										</p>
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

								{/* Trial Info or Next Billing */}
								<div className="flex items-start gap-3">
									<div className="p-2 bg-primary/10 rounded-lg">
										<IconCalendar className="size-5 text-primary" />
									</div>
									<div>
										{subscription.isTrialing ? (
											<>
												<p className="text-sm text-muted-foreground">
													{t("billing.trialEnds", "Trial Ends")}
												</p>
												<p className="text-2xl font-bold">
													{t("billing.days", "{count} days", { count: getTrialDaysRemaining() })}
												</p>
												<p className="text-xs text-muted-foreground">
													{formatDate(subscription.trialEnd)}
												</p>
											</>
										) : (
											<>
												<p className="text-sm text-muted-foreground">
													{t("billing.nextBilling", "Next Billing")}
												</p>
												<p className="text-2xl font-bold">
													{formatDate(subscription.currentPeriodEnd)}
												</p>
												{subscription.cancelAt && (
													<p className="text-xs text-destructive">
														{t("billing.cancelsOn", "Cancels on {date}", {
															date: formatDate(subscription.cancelAt),
														})}
													</p>
												)}
											</>
										)}
									</div>
								</div>

								{/* Monthly Cost */}
								<div className="flex items-start gap-3">
									<div className="p-2 bg-primary/10 rounded-lg">
										<IconCreditCard className="size-5 text-primary" />
									</div>
									<div>
										<p className="text-sm text-muted-foreground">
											{t("billing.monthlyCost", "Monthly Cost")}
										</p>
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
					{subscription.status === "trialing" && (
						<Alert>
							<IconCreditCard aria-hidden="true" className="size-4" />
							<AlertTitle>
								{t("billing.checkout.trialContinuesTitle", "Your trial continues after upgrade")}
							</AlertTitle>
							<AlertDescription>
								{t(
									"billing.checkout.trialContinuesDescription",
									"Stripe Checkout collects payment details now. Your paid subscription starts only after the trial expires.",
								)}
							</AlertDescription>
						</Alert>
					)}
				</>
			) : (
				/* No Subscription - Show Pricing */
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("billing.choosePlan", "Choose Your Plan")}</CardTitle>
							<CardDescription>
								{t(
									"billing.choosePlanDescription",
									"Start with a 14-day free trial. No credit card required to start.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-6 md:grid-cols-2">
								{/* Monthly Plan */}
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
												{t("billing.features.trial", "14-day free trial")}
											</li>
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
											onClick={() => handleSubscribe("month")}
											disabled={isLoading}
										>
											{isLoading
												? t("billing.starting", "Starting...")
												: t("billing.startTrial", "Start Free Trial")}
										</Button>
									</CardContent>
								</Card>

								{/* Yearly Plan */}
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
												{t("billing.features.trial", "14-day free trial")}
											</li>
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
											onClick={() => handleSubscribe("year")}
											disabled={isLoading}
										>
											{isLoading
												? t("billing.starting", "Starting...")
												: t("billing.startTrial", "Start Free Trial")}
										</Button>
									</CardContent>
								</Card>
							</div>
						</CardContent>
					</Card>

					<p className="text-center text-sm text-muted-foreground">
						{t(
							"billing.vatNotice",
							"Prices shown are net prices excluding VAT. VAT will be added where applicable.",
						)}
					</p>
				</div>
			)}

			{/* FAQ Section */}
			<Card>
				<CardHeader>
					<CardTitle>{t("billing.faq.title", "Frequently Asked Questions")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div>
						<h4 className="font-medium">
							{t("billing.faq.perSeat.question", "How does per-seat billing work?")}
						</h4>
						<p className="text-sm text-muted-foreground">
							{t(
								"billing.faq.perSeat.answer",
								"You're billed based on the number of active members in your organization. When you add or remove members, your subscription is automatically adjusted.",
							)}
						</p>
					</div>
					<div>
						<h4 className="font-medium">
							{t("billing.faq.afterTrial.question", "What happens after the trial?")}
						</h4>
						<p className="text-sm text-muted-foreground">
							{t(
								"billing.faq.afterTrial.answer",
								"After your 14-day trial ends, you'll be charged for the subscription plan you selected. You can cancel anytime before the trial ends to avoid charges.",
							)}
						</p>
					</div>
					<div>
						<h4 className="font-medium">
							{t("billing.faq.switch.question", "Can I switch between monthly and yearly?")}
						</h4>
						<p className="text-sm text-muted-foreground">
							{t(
								"billing.faq.switch.answer",
								"Yes! You can switch plans at any time through the billing portal. Changes take effect at your next billing cycle.",
							)}
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export function BillingPageClient(props: BillingPageClientProps) {
	return (
		<Suspense fallback={null}>
			<BillingPageClientContent {...props} />
		</Suspense>
	);
}
