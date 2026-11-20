"use client";

import { IconAlertTriangle, IconCircleCheck, IconLoader2, IconRotate } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	type PayrollSettlementCounts,
	previewSettlePayrollDaysAction,
	settlePayrollDaysAction,
	unsettlePayrollDaysAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

/**
 * Settling days by hand (#1896), for organisations that pay from the PDF or outside
 * Z8: every day of the workspace's scope and period, after a confirmation with the
 * counts and a warning for months that are not closed. Unsettling needs a reason.
 */
export function PayrollSettlementCard({
	filtersHaveNoMatches,
	refreshedAt,
	request,
	t,
}: {
	filtersHaveNoMatches: boolean;
	refreshedAt: string;
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	const queryClient = useQueryClient();
	const { data } = usePayrollPeriod(request, refreshedAt);
	const [preview, setPreview] = useState<PayrollSettlementCounts | null>(null);
	const [isLoadingPreview, setIsLoadingPreview] = useState(false);
	const [isSettling, setIsSettling] = useState(false);
	const [unsettleOpen, setUnsettleOpen] = useState(false);
	const settledDays = data?.settlement.settledDays ?? 0;
	const disabled = filtersHaveNoMatches || isLoadingPreview || isSettling;

	const refreshPeriod = () => queryClient.invalidateQueries({ queryKey: ["payroll", "period"] });

	async function openPreview() {
		setIsLoadingPreview(true);
		try {
			const result = await previewSettlePayrollDaysAction(request);
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			setPreview(result.data);
		} finally {
			setIsLoadingPreview(false);
		}
	}

	async function confirmSettle() {
		setIsSettling(true);
		try {
			const result = await settlePayrollDaysAction(request);
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t("payroll.settle.settled", "{count} days settled", { count: result.data.newDays }),
			);
			setPreview(null);
			await refreshPeriod();
		} finally {
			setIsSettling(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t("payroll.settle.title", "Settled days")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.settle.description",
						"Mark the period's days as paid when you pay from the PDF or outside Z8. Later payroll files leave settled days out. Settling does not lock any data.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-muted-foreground text-sm tabular-nums">
					{data
						? t("payroll.settle.counts", "{settled} settled, {unsettled} unsettled days", {
								settled: data.settlement.settledDays,
								unsettled: data.settlement.unsettledDays,
							})
						: null}
				</p>
				<div className="grid gap-2 sm:flex">
					<Button
						type="button"
						variant="outline"
						disabled={disabled || settledDays === 0}
						onClick={() => setUnsettleOpen(true)}
					>
						<IconRotate aria-hidden="true" className="size-4" />
						{t("payroll.settle.unsettleAction", "Unsettle days…")}
					</Button>
					<Button type="button" disabled={disabled} onClick={() => void openPreview()}>
						{isLoadingPreview ? (
							<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						) : (
							<IconCircleCheck aria-hidden="true" className="size-4" />
						)}
						{t("payroll.settle.action", "Settle days…")}
					</Button>
				</div>
			</CardContent>

			<Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("payroll.settle.confirmTitle", "Settle these days?")}</DialogTitle>
						<DialogDescription>
							{t(
								"payroll.settle.confirmDescription",
								"Settling records that the days' worked hours and absences of {period} have been paid.",
								{ period: request.label },
							)}
						</DialogDescription>
					</DialogHeader>
					{preview ? <SettlePreview preview={preview} t={t} /> : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setPreview(null)}>
							{t("payroll.settle.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							disabled={isSettling || !preview || preview.newDays === 0}
							onClick={() => void confirmSettle()}
						>
							{isSettling ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : null}
							{t("payroll.settle.confirm", "Settle {count} days", {
								count: preview?.newDays ?? 0,
							})}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<UnsettleDialog
				open={unsettleOpen}
				onOpenChange={setUnsettleOpen}
				onUnsettled={refreshPeriod}
				request={request}
				settledDays={settledDays}
				t={t}
			/>
		</Card>
	);
}

/** The counts and unclosed-month warning before settling; also before confirming an export as paid (#1899). */
export function SettlePreview({
	preview,
	t,
}: {
	preview: PayrollSettlementCounts;
	t: PayrollTranslate;
}) {
	return (
		<div className="flex flex-col gap-3 text-sm">
			<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
				<dt>{t("payroll.settle.newDays", "Newly settled days")}</dt>
				<dd className="text-right font-medium">{preview.newDays}</dd>
				<dt>{t("payroll.settle.alreadySettledDays", "Already settled, left as they are")}</dt>
				<dd className="text-right font-medium">{preview.alreadySettledDays}</dd>
			</dl>
			{preview.unclosedMonths.length > 0 ? (
				<Alert>
					<IconAlertTriangle aria-hidden="true" />
					<AlertTitle>{t("payroll.settle.unclosedTitle", "Months not closed")}</AlertTitle>
					<AlertDescription>
						{t(
							"payroll.settle.unclosedDescription",
							"{count} of these days are in months that are not closed, so their data can still change: {months}. You can settle them anyway.",
							{
								count: preview.unclosedMonths.reduce((sum, month) => sum + month.days, 0),
								months: preview.unclosedMonths.map((month) => month.month).join(", "),
							},
						)}
					</AlertDescription>
				</Alert>
			) : null}
		</div>
	);
}

function UnsettleDialog({
	open,
	onOpenChange,
	onUnsettled,
	request,
	settledDays,
	t,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUnsettled: () => Promise<void>;
	request: PayrollPeriodRequest;
	settledDays: number;
	t: PayrollTranslate;
}) {
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			const result = await unsettlePayrollDaysAction({ ...request, reason: value.reason });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t("payroll.settle.unsettled", "{count} days unsettled", {
					count: result.data.unsettledDays,
				}),
			);
			form.reset();
			onOpenChange(false);
			await onUnsettled();
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>{t("payroll.settle.unsettleTitle", "Unsettle days?")}</DialogTitle>
						<DialogDescription>
							{t(
								"payroll.settle.unsettleDescription",
								"The {count} settled days of {period} in this selection become unsettled, so a later payroll file can carry them again. The settlement history keeps what was paid.",
								{ count: settledDays, period: request.label },
							)}
						</DialogDescription>
					</DialogHeader>
					<form.Field
						name="reason"
						validators={{
							onSubmit: ({ value }) =>
								value.trim()
									? undefined
									: t("payroll.settle.reasonRequired", "A reason is required to unsettle days"),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)} required>
									{t("payroll.settle.reason", "Reason")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										rows={3}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("payroll.settle.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : null}
									{t("payroll.settle.unsettleConfirm", "Unsettle days")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
