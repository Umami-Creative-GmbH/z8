import { IconAlertTriangle, IconCheck, IconCreditCard } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AccessResult } from "./types";

interface BillingAlertsProps {
	accessResult: AccessResult;
	canceled: string | null;
	isTrialing: boolean;
	success: string | null;
}

export function BillingAlerts({ accessResult, canceled, isTrialing, success }: BillingAlertsProps) {
	const { t } = useTranslate();

	return (
		<>
			{success ? (
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
			) : null}

			{canceled ? (
				<Alert>
					<AlertDescription>
						{t(
							"billing.alerts.canceledDescription",
							"Checkout was canceled. You can try again whenever you're ready.",
						)}
					</AlertDescription>
				</Alert>
			) : null}

			{!accessResult.canAccess ? (
				<Alert variant="destructive">
					<IconAlertTriangle className="size-4" />
					<AlertTitle>
						{t("billing.alerts.subscriptionRequired", "Subscription Required")}
					</AlertTitle>
					<AlertDescription>
						{accessResult.reason === "trial_expired"
							? t("billing.access.trialExpired", "Your trial has expired. Subscribe to continue using the app.")
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
			) : null}

			{isTrialing ? (
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
			) : null}
		</>
	);
}
