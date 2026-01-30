"use client";

import { useForm } from "@tanstack/react-form";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { requestAbsence } from "@/app/[locale]/(app)/absences/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { calculateBusinessDaysWithHalfDays, formatDays } from "@/lib/absences/date-utils";
import type { DayPeriod, Holiday } from "@/lib/absences/types";
import { CategoryBadge } from "./category-badge";

interface RequestAbsenceDialogProps {
	categories: Array<{
		id: string;
		name: string;
		type: string;
		color: string | null;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
	}>;
	remainingDays: number;
	holidays?: Holiday[];
	trigger?: React.ReactNode;
	onSuccess?: () => void;
	// Props for controlled mode
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	initialDate?: string; // YYYY-MM-DD format
}

// Define default values with explicit types
const createDefaultValues = (initialDate?: string) => ({
	categoryId: "",
	startDate: initialDate || "",
	startPeriod: "full_day" as DayPeriod,
	endDate: initialDate || "",
	endPeriod: "full_day" as DayPeriod,
	notes: "",
});

export function RequestAbsenceDialog({
	categories,
	remainingDays,
	holidays = [],
	trigger,
	onSuccess,
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	initialDate,
}: RequestAbsenceDialogProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [internalOpen, setInternalOpen] = useState(false);

	// Memoize period options to avoid recreating on every render
	const periodOptions = useMemo<Array<{ value: DayPeriod; label: string }>>(
		() => [
			{ value: "full_day", label: t("absences.form.period.fullDay", "Full Day") },
			{ value: "am", label: t("absences.form.period.morningOnly", "Morning Only") },
			{ value: "pm", label: t("absences.form.period.afternoonOnly", "Afternoon Only") },
		],
		[t],
	);

	// Support both controlled and uncontrolled modes
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

	// Initialize form with TanStack Form
	const form = useForm({
		defaultValues: createDefaultValues(initialDate),
		onSubmit: async ({ value }) => {
			if (!value.categoryId || !value.startDate || !value.endDate) {
				toast.error(
					t("absences.form.errors.fillRequiredFields", "Please fill in all required fields"),
				);
				return;
			}

			// Get selected category for validation
			const selectedCategory = categories.find((c) => c.id === value.categoryId);
			const requestedDays = calculateBusinessDaysWithHalfDays(
				value.startDate,
				value.startPeriod,
				value.endDate,
				value.endPeriod,
				holidays,
			);
			const balanceAfterRequest = selectedCategory?.countsAgainstVacation
				? remainingDays - requestedDays
				: remainingDays;
			const insufficientBalance =
				selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0;

			if (insufficientBalance) {
				toast.error(t("absences.form.errors.insufficientBalance", "Insufficient vacation balance"));
				return;
			}

			// Validate same-day period logic
			const invalidSameDayPeriod =
				value.startDate === value.endDate && value.startPeriod === "pm" && value.endPeriod === "am";

			if (invalidSameDayPeriod) {
				toast.error(
					t(
						"absences.form.errors.invalidSameDayPeriod",
						"Cannot end in the morning if starting in the afternoon on the same day",
					),
				);
				return;
			}

			const result = await requestAbsence({
				categoryId: value.categoryId,
				startDate: value.startDate,
				startPeriod: value.startPeriod,
				endDate: value.endDate,
				endPeriod: value.endPeriod,
				notes: value.notes || undefined,
			});

			if (result.success) {
				toast.success(
					t("absences.toast.requestSubmitted", "Absence request submitted successfully"),
				);
				setOpen(false);
				form.reset();
				// Revalidate the page data to show the new absence
				router.refresh();
				onSuccess?.();
			} else {
				toast.error(
					result.error || t("absences.toast.requestFailed", "Failed to submit absence request"),
				);
			}
		},
	});

	// Update form when initialDate changes (for controlled mode)
	useEffect(() => {
		if (initialDate && open) {
			form.setFieldValue("startDate", initialDate);
			form.setFieldValue("endDate", initialDate);
		}
	}, [initialDate, open, form]);

	// Reset form when dialog closes
	useEffect(() => {
		if (!open) {
			form.reset();
		}
	}, [open, form]);

	// In controlled mode without a trigger, don't render DialogTrigger
	const showTrigger = !isControlled || trigger;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			{showTrigger && (
				<DialogTrigger asChild>
					{trigger || <Button>{t("absences.requestAbsence", "Request Absence")}</Button>}
				</DialogTrigger>
			)}
			<DialogContent className="sm:max-w-[500px]">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>{t("absences.form.title", "Request Absence")}</DialogTitle>
						<DialogDescription>
							{t(
								"absences.form.description",
								"Submit a request for time off. Your manager will be notified for approval.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						{/* Category Select */}
						<form.Field name="categoryId">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={field.state.meta.errors.length > 0}>
										{t("absences.form.absenceType", "Absence Type *")}
									</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value)}
									>
										<TFormControl hasError={field.state.meta.errors.length > 0}>
											<SelectTrigger>
												<SelectValue
													placeholder={t("absences.form.selectAbsenceType", "Select absence type")}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{categories.map((category) => (
												<SelectItem key={category.id} value={category.id}>
													<div className="flex items-center gap-2">
														<CategoryBadge
															name={category.name}
															type={category.type}
															color={category.color}
														/>
														{!category.requiresApproval && (
															<span className="text-xs text-muted-foreground">
																{t("absences.form.autoApproved", "(Auto-approved)")}
															</span>
														)}
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{/* Start Date and Period */}
						<div className="grid gap-2">
							<TFormLabel>{t("absences.form.startDate", "Start Date *")}</TFormLabel>
							<div className="grid grid-cols-2 gap-2">
								<form.Field name="startDate">
									{(field) => (
										<TFormControl hasError={field.state.meta.errors.length > 0}>
											<Input
												type="date"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
									)}
								</form.Field>
								<form.Field name="startPeriod">
									{(field) => (
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as DayPeriod)}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{periodOptions.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								</form.Field>
							</div>
						</div>

						{/* End Date and Period */}
						<form.Subscribe selector={(state) => state.values}>
							{(values) => {
								const invalidSameDayPeriod =
									values.startDate === values.endDate &&
									values.startPeriod === "pm" &&
									values.endPeriod === "am";

								return (
									<div className="grid gap-2">
										<TFormLabel>{t("absences.form.endDate", "End Date *")}</TFormLabel>
										<div className="grid grid-cols-2 gap-2">
											<form.Field name="endDate">
												{(field) => (
													<TFormControl hasError={field.state.meta.errors.length > 0}>
														<Input
															type="date"
															value={field.state.value}
															min={values.startDate}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															required
														/>
													</TFormControl>
												)}
											</form.Field>
											<form.Field name="endPeriod">
												{(field) => (
													<Select
														value={field.state.value}
														onValueChange={(value) => field.handleChange(value as DayPeriod)}
													>
														<SelectTrigger>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{periodOptions.map((option) => (
																<SelectItem key={option.value} value={option.value}>
																	{option.label}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												)}
											</form.Field>
										</div>
										{invalidSameDayPeriod && (
											<p className="text-xs text-destructive">
												{t(
													"absences.form.errors.invalidSameDayPeriod",
													"Cannot end in the morning if starting in the afternoon on the same day",
												)}
											</p>
										)}
									</div>
								);
							}}
						</form.Subscribe>

						{/* Business Days Calculation */}
						<form.Subscribe selector={(state) => state.values}>
							{(values) => {
								const requestedDays =
									values.startDate && values.endDate
										? calculateBusinessDaysWithHalfDays(
												values.startDate,
												values.startPeriod,
												values.endDate,
												values.endPeriod,
												holidays,
											)
										: 0;

								const selectedCategory = categories.find((c) => c.id === values.categoryId);
								const balanceAfterRequest = selectedCategory?.countsAgainstVacation
									? remainingDays - requestedDays
									: remainingDays;
								const insufficientBalance =
									selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0;

								if (requestedDays <= 0) return null;

								return (
									<div className="rounded-md border p-3 text-sm">
										<div className="flex justify-between items-center">
											<span className="text-muted-foreground">
												{t("absences.form.businessDays", "Business days:")}
											</span>
											<span className="font-semibold tabular-nums">
												{formatDays(requestedDays, t)}
											</span>
										</div>
										{selectedCategory?.countsAgainstVacation && (
											<>
												<div className="flex justify-between items-center mt-1">
													<span className="text-muted-foreground">
														{t("absences.form.daysRemaining", "Days remaining:")}
													</span>
													<span className="font-semibold tabular-nums">
														{formatDays(remainingDays, t)}
													</span>
												</div>
												<div className="flex justify-between items-center mt-1 pt-2 border-t">
													<span className="font-medium">
														{t("absences.form.balanceAfterRequest", "Balance after request:")}
													</span>
													<span
														className={`font-bold tabular-nums ${insufficientBalance ? "text-destructive" : ""}`}
													>
														{formatDays(balanceAfterRequest, t)}
													</span>
												</div>
												{insufficientBalance && (
													<div className="mt-2 text-xs text-destructive">
														{t(
															"absences.form.errors.insufficientBalanceForRequest",
															"Insufficient vacation balance for this request",
														)}
													</div>
												)}
											</>
										)}
									</div>
								);
							}}
						</form.Subscribe>

						{/* Notes */}
						<form.Field name="notes">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("absences.form.notesOptional", "Notes (Optional)")}</TFormLabel>
									<TFormControl>
										<Textarea
											placeholder={t(
												"absences.form.notesPlaceholder",
												"Add any additional information...",
											)}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											rows={3}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					{/* Footer with submit button that uses form.Subscribe for dirty/submitting state */}
					<form.Subscribe
						selector={(state) => ({
							isSubmitting: state.isSubmitting,
							values: state.values,
						})}
					>
						{({ isSubmitting, values }) => {
							const requestedDays =
								values.startDate && values.endDate
									? calculateBusinessDaysWithHalfDays(
											values.startDate,
											values.startPeriod,
											values.endDate,
											values.endPeriod,
											holidays,
										)
									: 0;
							const selectedCategory = categories.find((c) => c.id === values.categoryId);
							const balanceAfterRequest = selectedCategory?.countsAgainstVacation
								? remainingDays - requestedDays
								: remainingDays;
							const insufficientBalance =
								selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0;
							const invalidSameDayPeriod =
								values.startDate === values.endDate &&
								values.startPeriod === "pm" &&
								values.endPeriod === "am";

							return (
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onClick={() => setOpen(false)}
										disabled={isSubmitting}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button
										type="submit"
										disabled={isSubmitting || insufficientBalance || invalidSameDayPeriod}
									>
										{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										{t("absences.form.submitRequest", "Submit Request")}
									</Button>
								</DialogFooter>
							);
						}}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
}
