"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createTravelExpenseDraft } from "@/app/[locale]/(app)/travel-expenses/actions";
import { Button } from "@/components/ui/button";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import {
	TRAVEL_EXPENSE_VALIDATION_MESSAGES,
	type TravelExpenseClaimType,
} from "@/lib/travel-expenses/types";

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

export function getClaimValidationError(
	type: TravelExpenseClaimType,
	attachmentCount: number,
): string | null {
	if (type === "receipt" && attachmentCount < 1) {
		return TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED;
	}

	return null;
}

export function TravelExpenseClaimDialog({
	open,
	onOpenChange,
	onCreated,
}: TravelExpenseClaimDialogProps) {
	const [submitErrors, setSubmitErrors] = useState<{
		tripStart?: string;
		tripEnd?: string;
		amount?: string;
	}>({});
	const tripStartRef = useRef<HTMLInputElement>(null);
	const tripEndRef = useRef<HTMLInputElement>(null);
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
				nextErrors.tripStart = "Please provide a valid trip start date";
				nextErrors.tripEnd = "Please provide a valid trip end date";
				setSubmitErrors(nextErrors);
				tripStartRef.current?.focus();
				toast.error("Please provide a valid trip start and end date");
				return;
			}

			if (tripEnd < tripStart) {
				nextErrors.tripEnd = "Trip end date cannot be before trip start date";
				setSubmitErrors(nextErrors);
				tripEndRef.current?.focus();
				toast.error("Trip end date cannot be before trip start date");
				return;
			}

			if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
				nextErrors.amount = "Amount must be a positive number";
				setSubmitErrors(nextErrors);
				amountRef.current?.focus();
				toast.error("Amount must be a positive number");
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
				toast.error(result.error || "Failed to create travel expense draft");
				return;
			}

			toast.success("Travel expense draft created");
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[560px]">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Create Travel Expense Claim</DialogTitle>
						<DialogDescription>
							Create a new draft claim for your recent travel expenses.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<form.Field name="type">
							{(field) => (
								<TFormItem>
									<TFormLabel required>Claim Type</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) =>
											field.handleChange(value as TravelExpenseClaimType)
										}
									>
										<TFormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select claim type" />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value="receipt">Receipt</SelectItem>
											<SelectItem value="mileage">Mileage</SelectItem>
											<SelectItem value="per_diem">Per Diem</SelectItem>
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.type}>
							{(type) =>
								type === "receipt" ? (
									<p className="text-sm text-muted-foreground">
										Receipt claims require at least one attachment. Attachment upload will be
										available after draft creation.
									</p>
								) : null
							}
						</form.Subscribe>

						<div className="grid grid-cols-2 gap-3">
							<form.Field name="tripStart">
								{(field) => (
								<TFormItem>
									<TFormLabel required hasError={fieldHasError(field) || !!submitErrors.tripStart}>
										Trip Start
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field) || !!submitErrors.tripStart}>
										<Input
											name="tripStart"
											autoComplete="off"
											type="date"
											ref={tripStartRef}
											value={field.state.value}
											onChange={(event) => {
												setSubmitErrors((current) => ({ ...current, tripStart: undefined }));
												field.handleChange(event.target.value);
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
										Trip End
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field) || !!submitErrors.tripEnd}>
										<Input
											name="tripEnd"
											autoComplete="off"
											type="date"
											ref={tripEndRef}
											value={field.state.value}
											onChange={(event) => {
												setSubmitErrors((current) => ({ ...current, tripEnd: undefined }));
												field.handleChange(event.target.value);
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
										<TFormLabel>Destination City</TFormLabel>
									<TFormControl>
										<Input
											name="destinationCity"
											autoComplete="address-level2"
											placeholder="Berlin"
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
										<TFormLabel>Destination Country</TFormLabel>
									<TFormControl>
										<Input
											name="destinationCountry"
											autoComplete="country-name"
											placeholder="Germany"
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
										Amount
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
										<TFormLabel required>Currency</TFormLabel>
									<TFormControl>
										<Input
											name="currency"
											autoComplete="off"
											placeholder="EUR"
												maxLength={3}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value.toUpperCase())
												}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormDescription>ISO 4217 code, e.g. EUR or USD</TFormDescription>
									</TFormItem>
								)}
							</form.Field>
						</div>

						<form.Field name="notes">
							{(field) => (
								<TFormItem>
									<TFormLabel>Notes</TFormLabel>
									<TFormControl>
										<Textarea
											name="notes"
											autoComplete="off"
											placeholder="Add optional context for your approver"
											rows={4}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => onOpenChange(false)}
									disabled={isSubmitting}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
									Create Draft
								</Button>
							</DialogFooter>
						)}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
}
