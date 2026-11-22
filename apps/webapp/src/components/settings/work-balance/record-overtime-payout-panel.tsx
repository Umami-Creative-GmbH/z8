"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { payoutMinutes } from "@/lib/work-balance/adjustments/rules";
import { BalanceMinutesField, BalanceReasonField } from "./balance-adjustment-fields";
import { useBalanceAdjustmentErrorMessage } from "./use-balance-adjustment-error";
import { useBalanceFormRequest } from "./use-balance-form-request";
import { BalanceAdjustmentActionError } from "./use-employee-work-balance";

type RecordOvertimePayoutValues = {
	day: string;
	hours: string;
	minutes: string;
	reason: string;
};

export interface RecordOvertimePayoutPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Today in the employee's timezone: the latest day a payout may have. */
	today: string;
	/** Prefilled day and amount; without it the day is today and the amount empty. */
	initial?: { day: string; amountMinutes: number };
	/** Replaces the default panel title. */
	title?: string;
	onRecord: (input: {
		day: string;
		hours: number;
		minutes: number;
		reason: string;
	}) => Promise<unknown>;
}

/**
 * Records an overtime payout for the employee (#993). The offboarding review
 * opens it for a final payout prefilled with the remaining balance (#1002).
 */
export function RecordOvertimePayoutPanel({
	open,
	onOpenChange,
	today,
	initial,
	title,
	onRecord,
}: RecordOvertimePayoutPanelProps) {
	const { t } = useTranslate();
	const request = useBalanceFormRequest();
	const [failure, setFailure] = useState<string | null>(null);
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
		onSubmitInvalid: () => {
			document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus();
		},
		defaultValues,
		onSubmit: async ({ value }) => {
			const token = request.begin();
			if (!token) return;
			setFailure(null);
			try {
				await onRecord({
					day: value.day,
					hours: Number(value.hours || 0),
					minutes: Number(value.minutes || 0),
					reason: value.reason,
				});
			} catch (error) {
				if (!request.current(token)) return;
				request.finish(token);
				setFailure(
					error instanceof BalanceAdjustmentActionError
						? errorMessage(error.code, { closedMonth: error.closedMonth })
						: errorMessage(null),
				);
				return;
			}
			if (!request.current(token)) return;
			request.finish(token);
			toast.success(t("settings.employees.workBalance.payoutRecorded", "Overtime payout recorded"));
			form.reset(defaultValues);
			onOpenChange(false);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (request.pending()) return;
		if (!nextOpen) {
			setFailure(null);
			form.reset(defaultValues);
		}
		onOpenChange(nextOpen);
	}

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				onEscapeKeyDown={(event) => {
					if (request.pending()) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (request.pending()) event.preventDefault();
				}}
			>
				<form
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					onInvalid={(event) => {
						event.preventDefault();
					}}
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{title ??
								t("settings.employees.workBalance.recordPayoutTitle", "Record overtime payout")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.employees.workBalance.recordPayoutDescription",
								"Record overtime paid as wages. It lowers the work balance from the end of its day and cannot be more than the balance on that day.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
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
								{(field) => <BalanceMinutesField field={field} />}
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
								<BalanceReasonField
									field={field}
									placeholder={t(
										"settings.employees.workBalance.payoutReasonPlaceholder",
										"For example: paid with the October payroll…",
									)}
								/>
							)}
						</form.Field>

						{failure ? (
							<p role="alert" className="text-sm text-destructive">
								{failure}
							</p>
						) : null}
					</ActionPanelBody>

					<ActionPanelFooter>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<>
									<Button
										type="button"
										variant="outline"
										disabled={isSubmitting}
										onClick={() => handleOpenChange(false)}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting ? (
											<IconLoader2
												className="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										) : null}
										{t("settings.employees.workBalance.recordPayoutSubmit", "Record payout")}
									</Button>
								</>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
