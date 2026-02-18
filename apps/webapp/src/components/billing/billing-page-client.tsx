"use client";

import {
	IconAlertTriangle,
	IconCalendar,
	IconCheck,
	IconCreditCard,
	IconUsers,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";

interface SubscriptionInfo {
	id: string;
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

export function BillingPageClient({ subscription, accessResult, isOwner }: BillingPageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isLoading, setIsLoading] = useState(false);
	const [isPortalLoading, setIsPortalLoading] = useState(false);

	// Handle success/cancel redirects from Stripe
	const success = searchParams.get("success");
	const canceled = searchParams.get("canceled");

	const handleSubscribe = async (interval: "month" | "year") => {
		setIsLoading(true);
		const response = await fetch("/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ interval }),
		}).catch(() => null);

		if (!response) {
			toast.error("Failed to start checkout");
			setIsLoading(false);
			return;
		}

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			toast.error(data?.error || "Failed to create checkout session");
			setIsLoading(false);
			return;
		}

		if (!data?.url) {
			toast.error("Failed to start checkout");
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
			toast.error("Failed to open billing portal");
			setIsPortalLoading(false);
			return;
		}

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			toast.error(data?.error || "Failed to open billing portal");
			setIsPortalLoading(false);
			return;
		}

		if (!data?.url) {
			toast.error("Failed to open billing portal");
			setIsPortalLoading(false);
			return;
		}

		// Redirect to Stripe Portal
		window.location.href = data.url;
	};

	const formatDate = (dateStr: string | null) => {
		if (!dateStr) return "N/A";
		return DateTime.fromISO(dateStr).toLocaleString(DateTime.DATE_MED);
	};

	const getTrialDaysRemaining = () => {
		if (!subscription?.trialEnd) return 0;
		const trialEnd = DateTime.fromISO(subscription.trialEnd);
		const now = DateTime.now();
		return Math.max(0, Math.ceil(trialEnd.diff(now, "days").days));
	};

	const getStatusBadge = () => {
		if (!subscription) {
			return <Badge variant="outline">No Subscription</Badge>;
		}

		switch (subscription.status) {
			case "trialing":
				return <Badge variant="default">Trial</Badge>;
			case "active":
				return (
					<Badge variant="default" className="bg-green-600">
						Active
					</Badge>
				);
			case "past_due":
				return <Badge variant="destructive">Past Due</Badge>;
			case "canceled":
				return <Badge variant="secondary">Canceled</Badge>;
			default:
				return <Badge variant="outline">{subscription.status}</Badge>;
		}
	};

	return (
		<div className="space-y-6">
			{/* Success/Cancel Alerts */}
			{success && (
				<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
					<IconCheck className="h-4 w-4 text-green-600" />
					<AlertTitle>Success!</AlertTitle>
					<AlertDescription>
						Your subscription has been activated. Thank you for subscribing!
					</AlertDescription>
				</Alert>
			)}

			{canceled && (
				<Alert>
					<AlertDescription>
						Checkout was canceled. You can try again whenever you're ready.
					</AlertDescription>
				</Alert>
			)}

			{/* Warning Alert for access issues */}
			{!accessResult.canAccess && (
				<Alert variant="destructive">
					<IconAlertTriangle className="h-4 w-4" />
					<AlertTitle>Subscription Required</AlertTitle>
					<AlertDescription>
						{accessResult.reason === "trial_expired"
							? "Your trial has expired. Subscribe to continue using the app."
							: accessResult.reason === "payment_failed"
								? "Your last payment failed. Please update your payment method."
								: accessResult.reason === "canceled"
									? "Your subscription has been canceled. Resubscribe to regain access."
									: "A subscription is required to use this application."}
					</AlertDescription>
				</Alert>
			)}

			<div>
				<h1 className="text-3xl font-bold">Billing & Subscription</h1>
				<p className="text-muted-foreground mt-1">Manage your subscription and billing details</p>
			</div>

			{/* Current Subscription Card */}
			{subscription ? (
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									Current Plan {getStatusBadge()}
								</CardTitle>
								<CardDescription>
									{subscription.billingInterval === "year" ? "Yearly" : "Monthly"} billing
								</CardDescription>
							</div>
							<Button variant="outline" onClick={handleManageBilling} disabled={isPortalLoading}>
								{isPortalLoading ? "Opening..." : "Manage Billing"}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid gap-6 md:grid-cols-3">
							{/* Seats */}
							<div className="flex items-start gap-3">
								<div className="p-2 bg-primary/10 rounded-lg">
									<IconUsers className="h-5 w-5 text-primary" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Active Seats</p>
									<p className="text-2xl font-bold">{subscription.currentSeats}</p>
									<p className="text-xs text-muted-foreground">
										{subscription.billingInterval === "year"
											? `€${YEARLY_PRICE_PER_MONTH}/seat/mo (billed yearly)`
											: `€${MONTHLY_PRICE}/seat/mo`}
									</p>
								</div>
							</div>

							{/* Trial Info or Next Billing */}
							<div className="flex items-start gap-3">
								<div className="p-2 bg-primary/10 rounded-lg">
									<IconCalendar className="h-5 w-5 text-primary" />
								</div>
								<div>
									{subscription.isTrialing ? (
										<>
											<p className="text-sm text-muted-foreground">Trial Ends</p>
											<p className="text-2xl font-bold">{getTrialDaysRemaining()} days</p>
											<p className="text-xs text-muted-foreground">
												{formatDate(subscription.trialEnd)}
											</p>
										</>
									) : (
										<>
											<p className="text-sm text-muted-foreground">Next Billing</p>
											<p className="text-2xl font-bold">
												{formatDate(subscription.currentPeriodEnd)}
											</p>
											{subscription.cancelAt && (
												<p className="text-xs text-destructive">
													Cancels on {formatDate(subscription.cancelAt)}
												</p>
											)}
										</>
									)}
								</div>
							</div>

							{/* Monthly Cost */}
							<div className="flex items-start gap-3">
								<div className="p-2 bg-primary/10 rounded-lg">
									<IconCreditCard className="h-5 w-5 text-primary" />
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Monthly Cost</p>
									<p className="text-2xl font-bold">
										€
										{subscription.billingInterval === "year"
											? (subscription.currentSeats * YEARLY_PRICE_PER_MONTH).toFixed(2)
											: (subscription.currentSeats * MONTHLY_PRICE).toFixed(2)}
									</p>
									<p className="text-xs text-muted-foreground">
										{subscription.billingInterval === "year"
											? `€${(subscription.currentSeats * YEARLY_PRICE_TOTAL).toFixed(2)}/year total`
											: "billed monthly"}
									</p>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			) : (
				/* No Subscription - Show Pricing */
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Choose Your Plan</CardTitle>
							<CardDescription>
								Start with a 14-day free trial. No credit card required to start.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-6 md:grid-cols-2">
								{/* Monthly Plan */}
								<Card className="border-2">
									<CardHeader>
										<CardTitle>Monthly</CardTitle>
										<CardDescription>Flexible month-to-month billing</CardDescription>
									</CardHeader>
									<CardContent className="space-y-4">
										<div>
											<span className="text-4xl font-bold">€{MONTHLY_PRICE}</span>
											<span className="text-muted-foreground">/seat/month</span>
										</div>
										<ul className="space-y-2 text-sm">
											<li className="flex items-center gap-2">
												<IconCheck className="h-4 w-4 text-green-600" />
												14-day free trial
											</li>
											<li className="flex items-center gap-2">
												<IconCheck className="h-4 w-4 text-green-600" />
												Cancel anytime
											</li>
											<li className="flex items-center gap-2">
												<IconCheck className="h-4 w-4 text-green-600" />
												All features included
											</li>
										</ul>
										<Button
											className="w-full"
											variant="outline"
											onClick={() => handleSubscribe("month")}
											disabled={isLoading}
										>
											{isLoading ? "Starting..." : "Start Free Trial"}
										</Button>
									</CardContent>
								</Card>

								{/* Yearly Plan */}
								<Card className="border-2 border-primary">
									<CardHeader>
										<div className="flex items-center justify-between">
											<div>
												<CardTitle>Yearly</CardTitle>
												<CardDescription>Save 25% with annual billing</CardDescription>
											</div>
											<Badge>Best Value</Badge>
										</div>
									</CardHeader>
									<CardContent className="space-y-4">
										<div>
											<span className="text-4xl font-bold">€{YEARLY_PRICE_PER_MONTH}</span>
											<span className="text-muted-foreground">/seat/month</span>
											<p className="text-sm text-muted-foreground">
												€{YEARLY_PRICE_TOTAL}/seat billed annually
											</p>
										</div>
										<ul className="space-y-2 text-sm">
											<li className="flex items-center gap-2">
												<IconCheck className="h-4 w-4 text-green-600" />
												14-day free trial
											</li>
											<li className="flex items-center gap-2">
												<IconCheck className="h-4 w-4 text-green-600" />
												25% discount vs monthly
											</li>
											<li className="flex items-center gap-2">
												<IconCheck className="h-4 w-4 text-green-600" />
												All features included
											</li>
										</ul>
										<Button
											className="w-full"
											onClick={() => handleSubscribe("year")}
											disabled={isLoading}
										>
											{isLoading ? "Starting..." : "Start Free Trial"}
										</Button>
									</CardContent>
								</Card>
							</div>
						</CardContent>
					</Card>

					<p className="text-center text-sm text-muted-foreground">
						Prices shown are net prices excluding VAT. VAT will be added where applicable.
					</p>
				</div>
			)}

			{/* FAQ Section */}
			<Card>
				<CardHeader>
					<CardTitle>Frequently Asked Questions</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div>
						<h4 className="font-medium">How does per-seat billing work?</h4>
						<p className="text-sm text-muted-foreground">
							You're billed based on the number of active members in your organization. When you add
							or remove members, your subscription is automatically adjusted.
						</p>
					</div>
					<div>
						<h4 className="font-medium">What happens after the trial?</h4>
						<p className="text-sm text-muted-foreground">
							After your 14-day trial ends, you'll be charged for the subscription plan you
							selected. You can cancel anytime before the trial ends to avoid charges.
						</p>
					</div>
					<div>
						<h4 className="font-medium">Can I switch between monthly and yearly?</h4>
						<p className="text-sm text-muted-foreground">
							Yes! You can switch plans at any time through the billing portal. Changes take effect
							at your next billing cycle.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
