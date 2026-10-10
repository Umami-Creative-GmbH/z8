"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { openingBalanceMinutes } from "@/lib/work-balance/adjustments/rules";
import type { ConflictingPayout } from "@/lib/work-balance/adjustments/types";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import { useBalanceAdjustmentErrorMessage } from "./use-balance-adjustment-error";
import { BalanceAdjustmentActionError } from "./use-employee-work-balance";

type SetOpeningBalanceValues = {
	day: string;
	direction: "positive" | "negative";
	hours: string;
	minutes: string;
	reason: string;
};

/**
 * Sets the employee's opening balance (#997, ADR-0008). It replaces the work
 * balance up to and including its day; setting one cancels the one in effect.
 * A refusal because of overtime payouts lists them in the dialog.
 */
export function SetOpeningBalanceDialog({
	open,
	onOpenChange,
	today,
	replacesCurrent,
	onSet,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Today in the employee's timezone: the latest day an opening balance may have. */
	today: string;
	/** Whether an opening balance is in effect, which this one cancels. */
	replacesCurrent: boolean;
	onSet: (input: {
		day: string;
		negative: boolean;
		hours: number;
		minutes: number;
		reason: string;
	}) => Promise<unknown>;
}) {
	const { t } = useTranslate();
	const id = useId();
	const displayContext = useDisplayContext();
	const errorMessage = useBalanceAdjustmentErrorMessage();
	const [conflictingPayouts, setConflictingPayouts] = useState<ConflictingPayout[]>([]);
	const defaultValues: SetOpeningBalanceValues = {
		day: today,
		direction: "positive",
		hours: "",
		minutes: "0",
		reason: "",
	};
	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setConflictingPayouts([]);
			try {
				await onSet({
					day: value.day,
					negative: value.direction === "negative",
					hours: Number(value.hours || 0),
					minutes: Number(value.minutes || 0),
					reason: value.reason,
				});
			} catch (error) {
				const actionError = error instanceof BalanceAdjustmentActionError ? error : null;
				if (actionError?.code === "conflicting_payouts") {
					setConflictingPayouts(actionError.conflictingPayouts);
				}
				toast.error(errorMessage(actionError?.code ?? null));
				return;
			}
			toast.success(t("settings.employees.workBalance.openingBalanceSet", "Opening balance set"));
			form.reset(defaultValues);
			onOpenChange(false);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			form.reset(defaultValues);
			setConflictingPayouts([]);
		}
		onOpenChange(nextOpen);
	}

	const formatDay = (day: string) =>
		formatPlainDate(parsePlainDate(day), displayContext.locale, "dateMedium");
	const amountIsValid = (hours: string, minutes: string) =>
		openingBalanceMinutes({
			negative: false,
			hours: Number(hours || 0),
			minutes: Number(minutes || 0),
		}) !== null;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("settings.employees.workBalance.setOpeningBalanceTitle", "Set opening balance")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.employees.workBalance.setOpeningBalanceDescription",
								"The opening balance replaces the work balance up to and including its day. Work and required time before then stay on record but no longer count.",
							)}
						</DialogDescription>
					</DialogHeader>

					{replacesCurrent ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.employees.workBalance.replacesOpeningBalance",
								"The opening balance in effect is cancelled, with this reason.",
							)}
						</p>
					) : null}

					<form.Field
						name="day"
						validators={{
							onChange: ({ value }) =>
								value
									? undefined
									: t("settings.employees.workBalance.dayRequired", "Choose a day."),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)} required>
									{t(
										"settings.employees.workBalance.openingBalanceDay",
										"Balance as of the end of",
									)}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										name="day"
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
											setConflictingPayouts([]);
										}}
										onBlur={field.handleBlur}
										max={today}
										required
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.employees.workBalance.openingBalanceDayDescription",
										"In the employee's timezone. The balance counts again from the next day.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="direction">
						{(field) => (
							<fieldset className="space-y-2">
								<legend className="font-medium text-sm">
									{t("settings.employees.workBalance.direction", "Balance")}
								</legend>
								<RadioGroup
									value={field.state.value}
									onValueChange={(value) =>
										field.handleChange(value === "negative" ? "negative" : "positive")
									}
									className="flex flex-wrap gap-6"
								>
									<div className="flex items-center gap-2">
										<RadioGroupItem id={`${id}-positive`} value="positive" />
										<Label htmlFor={`${id}-positive`}>
											{t("settings.employees.workBalance.positive", "Overtime (+)")}
										</Label>
									</div>
									<div className="flex items-center gap-2">
										<RadioGroupItem id={`${id}-negative`} value="negative" />
										<Label htmlFor={`${id}-negative`}>
											{t("settings.employees.workBalance.negative", "Hours owed (−)")}
										</Label>
									</div>
								</RadioGroup>
							</fieldset>
						)}
					</form.Field>

					<div className="grid grid-cols-2 gap-4">
						<form.Field
							name="hours"
							validators={{
								onChange: ({ value, fieldApi }) =>
									amountIsValid(value, fieldApi.form.getFieldValue("minutes"))
										? undefined
										: t("settings.employees.workBalance.hoursInvalid", "Enter whole hours."),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.employees.workBalance.hours", "Hours")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="hours"
											type="number"
											inputMode="numeric"
											min={0}
											step={1}
											autoComplete="off"
											placeholder="0"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="minutes"
							validators={{
								onChange: ({ value }) => {
									const minutes = Number(value || 0);
									return Number.isInteger(minutes) && minutes >= 0 && minutes <= 59
										? undefined
										: t(
												"settings.employees.workBalance.minutesInvalid",
												"Enter minutes from 0 to 59.",
											);
								},
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.employees.workBalance.minutes", "Minutes")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="minutes"
											type="number"
											inputMode="numeric"
											min={0}
											max={59}
											step={1}
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Field
						name="reason"
						validators={{
							onChange: ({ value }) =>
								value.trim()
									? undefined
									: t("settings.employees.workBalance.errors.reasonRequired", "Enter a reason."),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)} required>
									{t("settings.employees.workBalance.reason", "Reason")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										name="reason"
										autoComplete="off"
										rows={3}
										maxLength={1000}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.employees.workBalance.openingBalanceReasonPlaceholder",
											"For example: balance carried over from the previous system…",
										)}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{conflictingPayouts.length > 0 ? (
						<Alert variant="destructive">
							<AlertTitle>
								{t(
									"settings.employees.workBalance.conflictingPayoutsTitle",
									"Overtime payouts on or before this day",
								)}
							</AlertTitle>
							<AlertDescription>
								<p>
									{t(
										"settings.employees.workBalance.conflictingPayoutsDescription",
										"They would no longer count. Cancel them first or choose an earlier day.",
									)}
								</p>
								<ul className="mt-2 list-disc space-y-1 pl-5">
									{conflictingPayouts.map((payout) => (
										<li key={payout.id} className="tabular-nums">
											{formatDay(payout.day)}: {formatSignedWorkBalance(payout.minutes)}
										</li>
									))}
								</ul>
							</AlertDescription>
						</Alert>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t(
										"settings.employees.workBalance.setOpeningBalanceSubmit",
										"Set opening balance",
									)}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
