"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	approveReferenceRateSource,
	getReferenceRateSettings,
	type ReferenceRateSettings,
	revokeReferenceRateSource,
} from "@/app/[locale]/(app)/settings/travel-expenses/reference-rate-actions";
import { formatPlainDate } from "@/components/travel-expenses/report/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormItem, TFormMessage } from "@/components/ui/tanstack-form";
import { compareInstants, parseInstant } from "@/lib/datetime/temporal-core";
import { queryKeys } from "@/lib/query/keys";

const queryKey = queryKeys.travelExpenses.referenceRateSettings();

/** An instant shown in the viewer's locale and zone; display only. */
function formatInstant(locale: string, value: string) {
	return parseInstant(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function ProviderStatus({ provider }: { provider: ReferenceRateSettings["provider"] }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const failing =
		provider.latestFailureAt !== null &&
		(provider.latestSuccessAt === null ||
			compareInstants(
				parseInstant(provider.latestFailureAt),
				parseInstant(provider.latestSuccessAt),
			) > 0);
	return (
		<div className="space-y-2 text-sm">
			<dl className="grid gap-x-3 gap-y-0.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
				<dt>
					{t("settings.travelExpenses.referenceRates.latestPublication", "Latest publication")}
				</dt>
				<dd>
					{provider.latestPublicationDate
						? formatPlainDate(locale, provider.latestPublicationDate)
						: t("settings.travelExpenses.referenceRates.notFetched", "Not fetched yet")}
				</dd>
				<dt>{t("settings.travelExpenses.referenceRates.latestFetch", "Last successful fetch")}</dt>
				<dd>
					{provider.latestSuccessAt
						? formatInstant(locale, provider.latestSuccessAt)
						: t("settings.travelExpenses.referenceRates.notFetched", "Not fetched yet")}
				</dd>
			</dl>
			{!provider.latestSuccessAt && (
				<p className="text-muted-foreground">
					{t(
						"settings.travelExpenses.referenceRates.firstFetch",
						"Rates are fetched every hour. Until the first fetch, expenses keep asking for a card charge or documented rate.",
					)}
				</p>
			)}
			{failing && (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription>
						{t(
							"settings.travelExpenses.referenceRates.fetchFailing",
							"The latest fetch failed. Expenses dated after the last successful fetch need a card charge or documented rate until the next fetch succeeds.",
						)}
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}

function ApproveForm() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { acknowledged: false },
		onSubmit: async ({ value }) => {
			setError(null);
			if (!value.acknowledged) {
				setError(
					t(
						"settings.travelExpenses.referenceRates.acknowledgeRequired",
						"Confirm that you understand how the reference rates may be used.",
					),
				);
				return;
			}
			const result = await approveReferenceRateSource({ provider: "ecb", acknowledged: true });
			if (!result.success) {
				toast.error(
					t(
						"settings.travelExpenses.referenceRates.approveFailed",
						"The reference rates could not be approved.",
					),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
			toast.success(
				t("settings.travelExpenses.referenceRates.approved", "ECB reference rates approved"),
			);
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
			<form.Field name="acknowledged">
				{(field) => (
					<TFormItem>
						<div className="flex items-start gap-2">
							<Checkbox
								id="reference-rate-acknowledged"
								checked={field.state.value}
								aria-invalid={!!error}
								onCheckedChange={(checked) => field.handleChange(checked === true)}
							/>
							<Label htmlFor="reference-rate-acknowledged" className="font-normal leading-snug">
								{t(
									"settings.travelExpenses.referenceRates.acknowledge",
									"I understand that the ECB publishes these rates for information only, for a limited set of currencies and only on working days, and that our organization chooses to reimburse with them.",
								)}
							</Label>
						</div>
						<TFormMessage>{error ?? undefined}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting && (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						)}
						{t("settings.travelExpenses.referenceRates.approve", "Approve ECB reference rates")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function ApprovedPolicy({ policy }: { policy: NonNullable<ReferenceRateSettings["policy"]> }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [revoking, setRevoking] = useState(false);

	async function revoke() {
		setRevoking(true);
		try {
			const result = await revokeReferenceRateSource();
			if (!result.success) {
				toast.error(
					t(
						"settings.travelExpenses.referenceRates.revokeFailed",
						"The reference rates could not be turned off.",
					),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
		} finally {
			setRevoking(false);
		}
	}

	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="text-sm">
				{t("settings.travelExpenses.referenceRates.approvedBy", "Approved by {name} on {date}.", {
					name: policy.approvedByName,
					date: formatInstant(locale, policy.approvedAt),
				})}
			</p>
			<Button type="button" variant="outline" disabled={revoking} onClick={() => void revoke()}>
				{revoking && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
				{t("settings.travelExpenses.referenceRates.revoke", "Stop using reference rates")}
			</Button>
		</div>
	);
}

/**
 * Whether the organization converts foreign-currency expenses with ECB
 * reference rates (#608). Off until an expense administrator explicitly
 * approves it; card charges and documented rates always take precedence.
 */
export function ReferenceRateSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getReferenceRateSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.referenceRates.title", "Reference exchange rates")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.referenceRates.intro",
						"With approval, a foreign-currency expense without a card charge or documented rate is converted with the European Central Bank's euro reference rate of the expense date. On weekends and TARGET holidays the latest earlier publication applies, and its real date is shown. Currencies the ECB does not publish, and dates without a retrievable rate, still need a card charge or documented rate. Submitted reports keep the rate they were submitted with.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{isLoading && <Skeleton aria-hidden="true" className="h-24 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.referenceRates.loadFailed",
								"The reference rate settings could not be loaded.",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							disabled={isFetching}
							onClick={() => void refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data &&
					(data.policy ? (
						<>
							<ApprovedPolicy policy={data.policy} />
							<ProviderStatus provider={data.provider} />
						</>
					) : (
						<ApproveForm />
					))}
			</CardContent>
		</Card>
	);
}
