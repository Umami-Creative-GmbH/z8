"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getReimbursementChannelSetting,
	type ReimbursementChannelSetting,
	saveReimbursementChannelSetting,
} from "@/app/[locale]/(app)/settings/travel-expenses/reimbursement-channel-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import { isReimbursementChannel } from "@/lib/travel-expenses/reimbursement-channel.types";

const queryKey = queryKeys.travelExpenses.reimbursementChannel();

function ChannelForm({ setting }: { setting: ReimbursementChannelSetting }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: { channel: setting.channel },
		onSubmit: async ({ value }) => {
			const result = await saveReimbursementChannelSetting({ channel: value.channel });
			if (!result.success) {
				toast.error(
					t(
						"travelExpenses.settings.reimbursementChannel.saveFailed",
						"The reimbursement channel could not be saved.",
					),
				);
				return;
			}
			queryClient.setQueryData(queryKey, result.data);
			toast.success(
				t("travelExpenses.settings.reimbursementChannel.saved", "Reimbursement channel saved"),
			);
		},
	});
	// The payroll run stays selectable for an organization that already uses it.
	const payrollRunDisabled = !setting.payrollRunAvailable && setting.channel !== "payroll_run";

	return (
		// Client-side TanStack Form submit (docs/refs/forms.md); the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			className="space-y-4"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field name="channel">
				{(field) => (
					<fieldset className="space-y-3">
						<legend className="sr-only">
							{t("travelExpenses.settings.reimbursementChannel.title", "Reimbursement channel")}
						</legend>
						<RadioGroup
							value={field.state.value}
							onValueChange={(value) => {
								if (isReimbursementChannel(value)) field.handleChange(value);
							}}
						>
							<div className="flex items-start gap-2">
								<RadioGroupItem
									value="bank_transfer"
									id="reimbursement-channel-bank-transfer"
									aria-describedby="reimbursement-channel-bank-transfer-description"
									className="mt-0.5"
								/>
								<div className="space-y-1">
									<Label htmlFor="reimbursement-channel-bank-transfer">
										{t(
											"travelExpenses.settings.reimbursementChannel.bankTransfer",
											"Bank transfer",
										)}
									</Label>
									<p
										id="reimbursement-channel-bank-transfer-description"
										className="text-sm text-muted-foreground"
									>
										{t(
											"travelExpenses.settings.reimbursementChannel.bankTransferDescription",
											"Expense officers pay reimbursements by bank transfer and record them in Z8.",
										)}
									</p>
								</div>
							</div>
							<div className="flex items-start gap-2">
								<RadioGroupItem
									value="payroll_run"
									id="reimbursement-channel-payroll-run"
									aria-describedby="reimbursement-channel-payroll-run-description"
									disabled={payrollRunDisabled}
									className="mt-0.5"
								/>
								<div className="space-y-1">
									<Label htmlFor="reimbursement-channel-payroll-run">
										{t("travelExpenses.settings.reimbursementChannel.payrollRun", "Payroll run")}
									</Label>
									<p
										id="reimbursement-channel-payroll-run-description"
										className="text-sm text-muted-foreground"
									>
										{payrollRunDisabled
											? t(
													"travelExpenses.settings.reimbursementChannel.payrollRunPreview",
													"In preview and not yet available for your organization.",
												)
											: t(
													"travelExpenses.settings.reimbursementChannel.payrollRunDescription",
													"The payroll export carries reimbursements, and expense officers confirm them once payroll is paid. Reports a payroll run cannot carry are paid by bank transfer.",
												)}
									</p>
								</div>
							</div>
						</RadioGroup>
					</fieldset>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.channel}>
				{(channel) =>
					channel === "bank_transfer" && setting.unconfirmedPayrollRuns > 0 ? (
						<Alert>
							<IconAlertTriangle aria-hidden="true" />
							<AlertDescription>
								{t(
									"travelExpenses.settings.reimbursementChannel.unconfirmedRuns",
									"{count, plural, one {# payroll run is} other {# payroll runs are}} not confirmed yet. Expense officers can still confirm or discard them.",
									{ count: setting.unconfirmedPayrollRuns },
								)}
							</AlertDescription>
						</Alert>
					) : null
				}
			</form.Subscribe>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting && (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						)}
						{t("travelExpenses.settings.reimbursementChannel.save", "Save channel")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

/** How the organization pays its reimbursements (#849). */
export function ReimbursementChannelSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getReimbursementChannelSetting();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("travelExpenses.settings.reimbursementChannel.title", "Reimbursement channel")}
				</CardTitle>
				<CardDescription>
					{t(
						"travelExpenses.settings.reimbursementChannel.intro",
						"How your organization pays reimbursements. The choice applies to every employee.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-24 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"travelExpenses.settings.reimbursementChannel.loadFailed",
								"The reimbursement channel could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && (
					<ChannelForm
						key={`${data.channel}:${data.payrollRunAvailable}:${data.unconfirmedPayrollRuns}`}
						setting={data}
					/>
				)}
			</CardContent>
		</Card>
	);
}
