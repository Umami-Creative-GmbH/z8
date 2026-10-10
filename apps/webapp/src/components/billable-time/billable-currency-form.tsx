"use client";

import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import {
	BILLABLE_CURRENCIES,
	type BillableCurrency,
	DEFAULT_BILLABLE_CURRENCY,
} from "@/lib/billable-time/currency";

/** "CHF – Swiss Franc" in the viewer's language; the code alone if the runtime lacks names. */
export function useBillableCurrencyLabel() {
	const language = useTolgee(["language"]).getLanguage() ?? "en";
	const names = useMemo(() => {
		try {
			return new Intl.DisplayNames([language], { type: "currency" });
		} catch {
			return null;
		}
	}, [language]);
	return (currency: BillableCurrency) => {
		const name = names?.of(currency);
		return name && name !== currency ? `${currency} – ${name}` : currency;
	};
}

interface BillableCurrencyFormProps {
	defaultCurrency?: BillableCurrency | null;
	disabled?: boolean;
	/** Resolves once the choice was saved; the form stays pending until then. */
	onSubmit: (currency: BillableCurrency) => Promise<void>;
	/** The form's buttons, rendered inside the form. `pending` is true while saving. */
	children: (state: { pending: boolean }) => ReactNode;
}

/**
 * Picks the organization's billable currency from the supported list (#897).
 * Used when Billable Time is first switched on and in its settings area.
 */
export function BillableCurrencyForm({
	defaultCurrency,
	disabled = false,
	onSubmit,
	children,
}: BillableCurrencyFormProps) {
	const { t } = useTranslate();
	const labelFor = useBillableCurrencyLabel();
	const form = useForm({
		defaultValues: {
			currency: (defaultCurrency ?? DEFAULT_BILLABLE_CURRENCY) as BillableCurrency,
		},
		onSubmit: async ({ value }) => {
			if (disabled) return;
			await onSubmit(value.currency);
		},
	});

	return (
		<form
			noValidate
			onSubmit={(event) => {
				// TanStack Form owns validation and the async submission; native submission would navigate away.
				// react-doctor-disable-next-line react-doctor/no-prevent-default
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4"
		>
			<form.Field name="currency">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.billableTime.currency.label", "Billable currency")}
						</TFormLabel>
						<Select
							value={field.state.value}
							onValueChange={(value) => {
								if (value) field.handleChange(value as BillableCurrency);
							}}
							disabled={disabled}
						>
							<TFormControl>
								<SelectTrigger className="w-full sm:w-72">
									<SelectValue />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								{BILLABLE_CURRENCIES.map((currency) => (
									<SelectItem key={currency} value={currency}>
										{labelFor(currency)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TFormDescription>
							{t(
								"settings.billableTime.currency.help",
								"All billable rates, cost rates, revenue and margin use this currency. It can't change once a billable rate or cost rate exists.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(pending) => children({ pending })}
			</form.Subscribe>
		</form>
	);
}
