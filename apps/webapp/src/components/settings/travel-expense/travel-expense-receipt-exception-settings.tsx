"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getReceiptExceptionSettings,
	type ReceiptExceptionSettings,
	saveReceiptExceptionSettings,
} from "@/app/[locale]/(app)/settings/travel-expenses/receipt-exception-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query/keys";

const queryKey = queryKeys.travelExpenses.receiptExceptionSettings();
const SWITCH_ID = "missing-receipt-exceptions-allowed";

function ReceiptExceptionForm({ settings }: { settings: ReceiptExceptionSettings }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: { allowed: settings.missingReceiptExceptionsAllowed },
		onSubmit: async ({ value }) => {
			const result = await saveReceiptExceptionSettings({
				missingReceiptExceptionsAllowed: value.allowed,
			});
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.travelExpenses.receiptExceptions.saveFailed",
							"Failed to save the missing-receipt setting",
						),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
			toast.success(
				t("settings.travelExpenses.receiptExceptions.saved", "Missing-receipt setting saved"),
			);
		},
	});

	return (
		// Client-side TanStack Form submit (docs/refs/forms.md); the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field name="allowed">
				{(field) => (
					<div className="flex items-start gap-3">
						<Switch
							id={SWITCH_ID}
							checked={field.state.value}
							onCheckedChange={(checked) => field.handleChange(checked)}
							aria-describedby={`${SWITCH_ID}-description`}
							className="mt-0.5"
						/>
						<div className="space-y-1">
							<Label htmlFor={SWITCH_ID}>
								{t(
									"settings.travelExpenses.receiptExceptions.label",
									"Allow explained missing-receipt exceptions",
								)}
							</Label>
							<p id={`${SWITCH_ID}-description`} className="text-sm text-muted-foreground">
								{t(
									"settings.travelExpenses.receiptExceptions.description",
									"Employees can submit a receipt expense without its receipt only by explaining why it is missing. Reviewers must accept each exception to approve the report. Receipts stay required for everything else, and turning this off keeps reports already submitted unchanged.",
								)}
							</p>
						</div>
					</div>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting && (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						)}
						{t("settings.travelExpenses.receiptExceptions.save", "Save setting")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

/** Organization setting for missing-receipt exceptions (#604). */
export function TravelExpenseReceiptExceptionSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getReceiptExceptionSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.receiptExceptions.title", "Missing receipts")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.receiptExceptions.intro",
						"Receipt expenses need a receipt. You can allow an explained exception for receipts that were lost or never issued.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-20 w-full" />}
				{isError && !data && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.receiptExceptions.loadFailed",
								"The missing-receipt setting could not be loaded.",
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
				{data && (
					<ReceiptExceptionForm
						key={String(data.missingReceiptExceptionsAllowed)}
						settings={data}
					/>
				)}
			</CardContent>
		</Card>
	);
}
