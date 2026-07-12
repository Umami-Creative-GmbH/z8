import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BillingFaq() {
	const { t } = useTranslate();

	return (
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
	);
}
