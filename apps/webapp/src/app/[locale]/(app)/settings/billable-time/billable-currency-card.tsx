"use client";

import { IconLoader2, IconLock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	BillableCurrencyForm,
	useBillableCurrencyLabel,
} from "@/components/billable-time/billable-currency-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { useRouter } from "@/navigation";
import { updateBillableCurrency } from "./actions";

export function BillableCurrencyCard({
	currency,
	locked,
}: {
	currency: BillableCurrency;
	/** A billable rate or cost rate exists, so the currency is read-only. */
	locked: boolean;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const labelFor = useBillableCurrencyLabel();

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.billableTime.currency.title", "Billable currency")}</CardTitle>
				<CardDescription>
					{t(
						"settings.billableTime.currency.description",
						"The one currency your billable rates, cost rates, revenue and margin are expressed in.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{locked ? (
					<div className="space-y-2">
						<p className="flex items-center gap-2 text-sm font-medium">
							<IconLock aria-hidden="true" className="size-4 text-muted-foreground" />
							{labelFor(currency)}
						</p>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.billableTime.currency.locked",
								"Billable rates or cost rates already use this currency, so it can no longer change.",
							)}
						</p>
					</div>
				) : (
					<BillableCurrencyForm
						key={currency}
						defaultCurrency={currency}
						onSubmit={async (next) => {
							if (next === currency) return;
							const result = await updateBillableCurrency({ currency: next });
							if (!result.success) {
								toast.error(result.error);
								return;
							}
							toast.success(t("settings.billableTime.currency.saved", "Billable currency saved"));
							router.refresh();
						}}
					>
						{({ pending }) => (
							<Button type="submit" disabled={pending}>
								{pending && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
								{t("settings.billableTime.currency.save", "Save currency")}
							</Button>
						)}
					</BillableCurrencyForm>
				)}
			</CardContent>
		</Card>
	);
}
