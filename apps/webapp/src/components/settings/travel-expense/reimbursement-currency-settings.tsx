"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getReimbursementCurrencySetting,
	saveReimbursementCurrencySetting,
} from "@/app/[locale]/(app)/settings/travel-expenses/conversion-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query/keys";
import { isReimbursementCurrencySupported } from "@/lib/travel-expenses/currency-conversion";

const queryKey = queryKeys.travelExpenses.reimbursementCurrency();

function CurrencyForm({ currency }: { currency: string }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: { currency },
		onSubmit: async ({ value }) => {
			const result = await saveReimbursementCurrencySetting({ currency: value.currency });
			if (!result.success) {
				toast.error(
					t(
						"settings.travelExpenses.currency.saveFailed",
						"The reimbursement currency could not be saved.",
					),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
			toast.success(t("settings.travelExpenses.currency.saved", "Reimbursement currency saved"));
		},
	});

	return (
		<form
			className="space-y-4"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="currency"
				validators={{
					onSubmit: ({ value }) =>
						isReimbursementCurrencySupported(value.trim().toUpperCase())
							? undefined
							: t(
									"settings.travelExpenses.currency.invalid",
									"Enter a three-letter currency code with at most two decimal places, e.g. EUR or CHF.",
								),
				}}
			>
				{(field) => {
					const error = field.state.meta.errors[0];
					return (
						<TFormItem>
							<TFormLabel hasError={!!error}>
								{t("settings.travelExpenses.currency.label", "Reimbursement currency")}
							</TFormLabel>
							<TFormControl hasError={!!error}>
								<Input
									name="currency"
									autoComplete="off"
									maxLength={3}
									className="w-28 uppercase"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.travelExpenses.currency.description",
									"New expense reports are reimbursed in this currency; existing reports keep theirs. Approval amount thresholds are compared in EUR, so while amount-based approval rules exist, reports in another currency cannot be submitted.",
								)}
							</TFormDescription>
							<TFormMessage>{typeof error === "string" ? error : undefined}</TFormMessage>
						</TFormItem>
					);
				}}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting && (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						)}
						{t("settings.travelExpenses.currency.save", "Save currency")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

/** The organization's reimbursement currency for new expense reports (#607). */
export function ReimbursementCurrencySettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getReimbursementCurrencySetting();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.currency.title", "Reimbursement currency")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.currency.intro",
						"Receipts in other currencies keep their original amount and are converted by an evidenced card charge or a documented rate.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-20 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.currency.loadFailed",
								"The reimbursement currency could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <CurrencyForm key={data.currency} currency={data.currency} />}
			</CardContent>
		</Card>
	);
}
