"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createTravelExpenseDraft } from "@/app/[locale]/(app)/travel-expenses/actions";
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
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { TravelExpenseClaimType } from "@/lib/travel-expenses/types";
import { getClaimValidationError } from "./travel-expense-claim-utils";

interface TravelExpenseClaimDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: () => void | Promise<void>;
}

interface ClaimFormValues {
	type: TravelExpenseClaimType;
	tripStart: string;
	tripEnd: string;
	destinationCity: string;
	destinationCountry: string;
	amount: string;
	currency: string;
	notes: string;
}

function createDefaultValues(): ClaimFormValues {
	return {
		type: "receipt",
		tripStart: "",
		tripEnd: "",
		destinationCity: "",
		destinationCountry: "",
		amount: "",
		currency: "EUR",
		notes: "",
	};
}

export function TravelExpenseClaimDialog({
	open,
	onOpenChange,
	onCreated,
}: TravelExpenseClaimDialogProps) {
	const { t } = useTranslate();
	const [submitErrors, setSubmitErrors] = useState<{
		tripStart?: string;
		tripEnd?: string;
		amount?: string;
	}>({});
	const tripStartRef = useRef<HTMLButtonElement>(null);
	const tripEndRef = useRef<HTMLButtonElement>(null);
	const amountRef = useRef<HTMLInputElement>(null);

	const form = useForm({
		defaultValues: createDefaultValues(),
		onSubmit: async ({ value }) => {
			const tripStart = DateTime.fromISO(value.tripStart);
			const tripEnd = DateTime.fromISO(value.tripEnd);
			const amountNumber = Number(value.amount);
			const attachmentCount = 0;
			const nextErrors: { tripStart?: string; tripEnd?: string; amount?: string } = {};

			if (!tripStart.isValid || !tripEnd.isValid) {
				nextErrors.tripStart = t(
					"travelExpenses.form.errors.validTripStart",
					"Please provide a valid trip start date",
				);
				nextErrors.tripEnd = t(
					"travelExpenses.form.errors.validTripEnd",
					"Please provide a valid trip end date",
				);
				setSubmitErrors(nextErrors);
				tripStartRef.current?.focus();
				toast.error(
					t(
						"travelExpenses.form.errors.validTripDates",
						"Please provide a valid trip start and end date",
					),
				);
				return;
			}

			if (tripEnd < tripStart) {
				nextErrors.tripEnd = t(
					"travelExpenses.form.errors.tripEndBeforeStart",
					"Trip end date cannot be before trip start date",
				);
				setSubmitErrors(nextErrors);
				tripEndRef.current?.focus();
				toast.error(
					t(
						"travelExpenses.form.errors.tripEndBeforeStart",
						"Trip end date cannot be before trip start date",
					),
				);
				return;
			}

			if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
				nextErrors.amount = t(
					"travelExpenses.form.errors.positiveAmount",
					"Amount must be a positive number",
				);
				setSubmitErrors(nextErrors);
				amountRef.current?.focus();
				toast.error(
					t("travelExpenses.form.errors.positiveAmount", "Amount must be a positive number"),
				);
				return;
			}

			setSubmitErrors({});

			const validationError = getClaimValidationError(value.type, attachmentCount);
			if (validationError) {
				toast.error(validationError);
				return;
			}

			const normalizedAmount = amountNumber.toFixed(2);

			const result = await createTravelExpenseDraft({
				type: value.type,
				tripStart: tripStart.startOf("day").toJSDate(),
				tripEnd: tripEnd.endOf("day").toJSDate(),
				destinationCity: value.destinationCity || null,
				destinationCountry: value.destinationCountry || null,
				originalCurrency: value.currency,
				originalAmount: normalizedAmount,
				calculatedCurrency: value.currency,
				calculatedAmount: normalizedAmount,
				notes: value.notes || null,
			});

			if (!result.success) {
				toast.error(
					result.error ||
						t("travelExpenses.form.errors.createDraft", "Failed to create travel expense draft"),
				);
				return;
			}

			toast.success(t("travelExpenses.form.created", "Travel expense draft created"));
			form.reset();
			await onCreated?.();
		},
	});

	useEffect(() => {
		if (!open) {
			form.reset();
			setSubmitErrors({});
		}
	}, [open, form]);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("travelExpenses.form.title", "Create Travel Expense Claim")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"travelExpenses.form.description",
							"Create a new draft claim for your recent travel expenses.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="grid gap-4">
						<form.Field name="type">
							{(field) => (
								<TFormItem>
									<TFormLabel required>
										{t("travelExpenses.form.claimType", "Claim Type")}
									</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as TravelExpenseClaimType)}
									>
										<TFormControl>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"travelExpenses.form.selectClaimType",
														"Select claim type",
													)}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value="receipt">
												{t("travelExpenses.claimTypes.receipt", "Receipt")}
											</SelectItem>
											<SelectItem value="mileage">
												{t("travelExpenses.claimTypes.mileage", "Mileage")}
											</SelectItem>
											<SelectItem value="per_diem">
												{t("travelExpenses.claimTypes.per_diem", "Per Diem")}
											</SelectItem>
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.type}>
							{(type) =>
								type === "receipt" ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.form.receiptAttachmentHint",
											"Receipt claims require at least one attachment. Attachment upload will be available after draft creation.",
										)}
									</p>
								) : null
							}
						</form.Subscribe>

						<div className="grid grid-cols-2 gap-3">
							<form.Field name="tripStart">
								{(field) => (
									<TFormItem>
										<TFormLabel
											required
											hasError={fieldHasError(field) || !!submitErrors.tripStart}
										>
											{t("travelExpenses.form.tripStart", "Trip Start")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field) || !!submitErrors.tripStart}>
											<DatePicker
												name="tripStart"
												ref={tripStartRef}
												value={field.state.value}
												onChange={(value) => {
													setSubmitErrors((current) => ({ ...current, tripStart: undefined }));
													field.handleChange(value);
												}}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormMessage field={field}>{submitErrors.tripStart}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="tripEnd">
								{(field) => (
									<TFormItem>
										<TFormLabel required hasError={fieldHasError(field) || !!submitErrors.tripEnd}>
											{t("travelExpenses.form.tripEnd", "Trip End")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field) || !!submitErrors.tripEnd}>
											<DatePicker
												name="tripEnd"
												ref={tripEndRef}
												value={field.state.value}
												onChange={(value) => {
													setSubmitErrors((current) => ({ ...current, tripEnd: undefined }));
													field.handleChange(value);
												}}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormMessage field={field}>{submitErrors.tripEnd}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<form.Field name="destinationCity">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("travelExpenses.form.destinationCity", "Destination City")}
										</TFormLabel>
										<TFormControl>
											<Input
												name="destinationCity"
												autoComplete="address-level2"
												placeholder={t("travelExpenses.form.destinationCityPlaceholder", "Berlin")}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="destinationCountry">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("travelExpenses.form.destinationCountry", "Destination Country")}
										</TFormLabel>
										<TFormControl>
											<Input
												name="destinationCountry"
												autoComplete="country-name"
												placeholder={t(
													"travelExpenses.form.destinationCountryPlaceholder",
													"Germany",
												)}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
									</TFormItem>
								)}
							</form.Field>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<form.Field name="amount">
								{(field) => (
									<TFormItem>
										<TFormLabel required hasError={fieldHasError(field) || !!submitErrors.amount}>
											{t("travelExpenses.form.amount", "Amount")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field) || !!submitErrors.amount}>
											<Input
												name="amount"
												autoComplete="off"
												type="number"
												ref={amountRef}
												step="0.01"
												min="0"
												value={field.state.value}
												onChange={(event) => {
													setSubmitErrors((current) => ({ ...current, amount: undefined }));
													field.handleChange(event.target.value);
												}}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormMessage field={field}>{submitErrors.amount}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="currency">
								{(field) => (
									<TFormItem>
										<TFormLabel required>
											{t("travelExpenses.form.currency", "Currency")}
										</TFormLabel>
										<TFormControl>
											<Input
												name="currency"
												autoComplete="off"
												placeholder={t("travelExpenses.form.currencyPlaceholder", "EUR")}
												maxLength={3}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"travelExpenses.form.currencyDescription",
												"ISO 4217 code, e.g. EUR or USD",
											)}
										</TFormDescription>
									</TFormItem>
								)}
							</form.Field>
						</div>

						<form.Field name="notes">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("travelExpenses.form.notes", "Notes")}</TFormLabel>
									<TFormControl>
										<Textarea
											name="notes"
											autoComplete="off"
											placeholder={t(
												"travelExpenses.form.notesPlaceholder",
												"Add optional context for your approver",
											)}
											rows={4}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
					</ActionPanelBody>

					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<ActionPanelFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => onOpenChange(false)}
									disabled={isSubmitting}
								>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
									)}
									{t("travelExpenses.form.createDraft", "Create Draft")}
								</Button>
							</ActionPanelFooter>
						)}
					</form.Subscribe>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
