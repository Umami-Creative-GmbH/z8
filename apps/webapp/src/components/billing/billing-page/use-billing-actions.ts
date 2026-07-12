import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";

export function useBillingActions() {
	const { t } = useTranslate();
	const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
	const [isPortalLoading, setIsPortalLoading] = useState(false);

	const startCheckout = async (interval: "month" | "year") => {
		setIsCheckoutLoading(true);
		const response = await fetch("/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ interval }),
		}).catch(() => null);

		if (!response) {
			toast.error(t("billing.checkoutStartFailed", "Failed to start checkout"));
			setIsCheckoutLoading(false);
			return;
		}

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			toast.error(
				data?.error || t("billing.checkoutCreateFailed", "Failed to create checkout session"),
			);
			setIsCheckoutLoading(false);
			return;
		}

		if (!data?.url) {
			toast.error(t("billing.checkoutStartFailed", "Failed to start checkout"));
			setIsCheckoutLoading(false);
			return;
		}

		window.location.href = data.url;
	};

	const openBillingPortal = async () => {
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

		window.location.href = data.url;
	};

	return { isCheckoutLoading, isPortalLoading, openBillingPortal, startCheckout };
}
