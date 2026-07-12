"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BillingPricingCards } from "./pricing-cards";
import { BillingAlerts } from "./billing-page/billing-alerts";
import { BillingFaq } from "./billing-page/billing-faq";
import { SubscriptionSummary } from "./billing-page/subscription-summary";
import type { BillingPageClientProps } from "./billing-page/types";
import { useBillingActions } from "./billing-page/use-billing-actions";

function BillingPageClientContent({ subscription, accessResult }: BillingPageClientProps) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const { isCheckoutLoading, isPortalLoading, openBillingPortal, startCheckout } = useBillingActions();
	const success = searchParams.get("success");
	const canceled = searchParams.get("canceled");
	const canManageBilling = Boolean(
		subscription?.hasStripeCustomer && subscription.hasStripeSubscription,
	);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<BillingAlerts
				accessResult={accessResult}
				canceled={canceled}
				isTrialing={subscription?.status === "trialing"}
				success={success}
			/>

			<div>
				<h1 className="text-3xl font-bold">{t("billing.title", "Billing & Subscription")}</h1>
				<p className="text-muted-foreground mt-1">
					{t("billing.description", "Manage your subscription and billing details")}
				</p>
			</div>

			{subscription ? (
				<>
					<SubscriptionSummary
						canManageBilling={canManageBilling}
						isPortalLoading={isPortalLoading}
						onManageBilling={openBillingPortal}
						subscription={subscription}
					/>
					{subscription.isTrialing && !canManageBilling ? (
						<BillingPricingCards
							buttonLabels={{
								monthly: t("billing.upgradeMonthly", "Upgrade Monthly"),
								yearly: t("billing.upgradeYearly", "Upgrade Yearly"),
							}}
							description={t(
								"billing.chooseUpgradePlanDescription",
								"Choose a billing cadence now. Your paid subscription starts only after the remaining trial period.",
							)}
							isLoading={isCheckoutLoading}
							onSubscribe={startCheckout}
							title={t("billing.choosePlan", "Choose Your Plan")}
						/>
					) : null}
				</>
			) : (
				<div className="space-y-6">
					<BillingPricingCards
						buttonLabels={{
							monthly: t("billing.startTrial", "Start Free Trial"),
							yearly: t("billing.startTrial", "Start Free Trial"),
						}}
						isLoading={isCheckoutLoading}
						onSubscribe={startCheckout}
					/>
					<p className="text-center text-sm text-muted-foreground">
						{t(
							"billing.vatNotice",
							"Prices shown are net prices excluding VAT. VAT will be added where applicable.",
						)}
					</p>
				</div>
			)}

			<BillingFaq />
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
