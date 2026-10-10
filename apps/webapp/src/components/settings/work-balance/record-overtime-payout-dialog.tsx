"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
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
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { payoutMinutes } from "@/lib/work-balance/adjustments/rules";
import { useBalanceAdjustmentErrorMessage } from "./use-balance-adjustment-error";
import { BalanceAdjustmentActionError } from "./use-employee-work-balance";

type RecordOvertimePayoutValues = {
	day: string;
	hours: string;
	minutes: string;
	reason: string;
};

/**
 * Records an overtime payout for the employee (#993). The offboarding review
 * opens it for a final payout prefilled with the remaining balance (#1002).
 */
export function RecordOvertimePayoutDialog({
	open,
	onOpenChange,
	today,
	initial,
	title,
	onRecord,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Today in the employee's timezone: the latest day a payout may have. */
	today: string;
	/** Prefilled day and amount; without it the day is today and the amount empty. */
	initial?: { day: string; amountMinutes: number };
	/** Replaces the default dialog title. */
	title?: string;
	onRecord: (input: {
		day: string;
		hours: number;
		minutes: number;
		reason: string;
	}) => Promise<unknown>;
}) {
	const { t } = useTranslate();
	const errorMessage = useBalanceAdjustmentErrorMessage();
	const defaultValues: RecordOvertimePayoutValues = initial
		? {
				day: initial.day,
				hours: String(Math.floor(initial.amountMinutes / 60)),
				minutes: String(initial.amountMinutes % 60),
				reason: "",
			}
		: {
				day: today,
				hours: "",
				minutes: "0",
				reason: "",
			};
	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			try {
				await onRecord({
					day: value.day,
					hours: Number(value.hours || 0),
					minutes: Number(value.minutes || 0),
					reason: value.reason,
				});
			} catch (error) {
				toast.error(
					errorMessage(error instanceof BalanceAdjustmentActionError ? error.code : null),
				);
				return;
			}
			toast.success(t("settings.employees.workBalance.payoutRecorded", "Overtime payout recorded"));
			form.reset(defaultValues);
			onOpenChange(false);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) form.reset(defaultValues);
		onOpenChange(nextOpen);
	}

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
							{title ??
								t("settings.employees.workBalance.recordPayoutTitle", "Record overtime payout")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.employees.workBalance.recordPayoutDescription",
								"Record overtime paid as wages. It lowers the work balance from the end of its day and cannot be more than the balance on that day.",
							)}
						</DialogDescription>
					</DialogHeader>

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
									{t("settings.employees.workBalance.day", "Day")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										name="day"
										value={field.state.value}
										onChange={(value) => field.handleChange(value)}
										onBlur={field.handleBlur}
										max={today}
										required
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.employees.workBalance.dayDescription",
										"In the employee's timezone. The balance shown runs through yesterday, so a payout dated today counts from tomorrow.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid grid-cols-2 gap-4">
						<form.Field
							name="hours"
							validators={{
								onChange: ({ value, fieldApi }) =>
									payoutMinutes({
										hours: Number(value || 0),
										minutes: Number(fieldApi.form.getFieldValue("minutes") || 0),
									}) === null
										? t("settings.employees.workBalance.hoursInvalid", "Enter whole hours.")
										: undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
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
											"settings.employees.workBalance.payoutReasonPlaceholder",
											"For example: paid with the October payroll…",
										)}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

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
									{t("settings.employees.workBalance.recordPayoutSubmit", "Record payout")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
