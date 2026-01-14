"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { calculateBusinessDaysWithHalfDays } from "@/lib/absences/date-utils";
import type { DayPeriod } from "@/lib/absences/types";
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
	trigger?: React.ReactNode;
	onSuccess?: () => void;
	// Props for controlled mode
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	initialDate?: string; // YYYY-MM-DD format
}

export function RequestAbsenceDialog({
	categories,
	remainingDays,
	trigger,
	onSuccess,
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	initialDate,
}: RequestAbsenceDialogProps) {
	const { t } = useTranslate();
	const [internalOpen, setInternalOpen] = useState(false);

	const periodOptions: Array<{ value: DayPeriod; label: string }> = [
		{ value: "full_day", label: t("absences.form.period.fullDay", "Full Day") },
		{ value: "am", label: t("absences.form.period.morningOnly", "Morning Only") },
		{ value: "pm", label: t("absences.form.period.afternoonOnly", "Afternoon Only") },
	];
	const [loading, setLoading] = useState(false);
	const [formData, setFormData] = useState({
		categoryId: "",
		startDate: initialDate || "",
		startPeriod: "full_day" as DayPeriod,
		endDate: initialDate || "",
		endPeriod: "full_day" as DayPeriod,
		notes: "",
	});

	// Support both controlled and uncontrolled modes
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

	// Update form when initialDate changes (for controlled mode)
	useEffect(() => {
		if (initialDate && open) {
			setFormData((prev) => ({
				...prev,
				startDate: initialDate,
				endDate: initialDate,
			}));
		}
	}, [initialDate, open]);

	const selectedCategory = categories.find((c) => c.id === formData.categoryId);

	// Calculate requested days with half-day support
	const requestedDays =
		formData.startDate && formData.endDate
			? calculateBusinessDaysWithHalfDays(
					formData.startDate,
					formData.startPeriod,
					formData.endDate,
					formData.endPeriod,
					[],
				)
			: 0;

	const balanceAfterRequest = selectedCategory?.countsAgainstVacation
		? remainingDays - requestedDays
		: remainingDays;

	const insufficientBalance = selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0;

	// Validate same-day period logic
	const invalidSameDayPeriod =
		formData.startDate === formData.endDate &&
		formData.startPeriod === "pm" &&
		formData.endPeriod === "am";

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!formData.categoryId || !formData.startDate || !formData.endDate) {
			toast.error(
				t("absences.form.errors.fillRequiredFields", "Please fill in all required fields"),
			);
			return;
		}

		if (insufficientBalance) {
			toast.error(t("absences.form.errors.insufficientBalance", "Insufficient vacation balance"));
			return;
		}

		if (invalidSameDayPeriod) {
			toast.error(
				t(
					"absences.form.errors.invalidSameDayPeriod",
					"Cannot end in the morning if starting in the afternoon on the same day",
				),
			);
			return;
		}

		setLoading(true);

		const result = await requestAbsence({
			categoryId: formData.categoryId,
			startDate: formData.startDate,
			startPeriod: formData.startPeriod,
			endDate: formData.endDate,
			endPeriod: formData.endPeriod,
			notes: formData.notes || undefined,
		});

		setLoading(false);

		if (result.success) {
			toast.success(t("absences.toast.requestSubmitted", "Absence request submitted successfully"));
			setOpen(false);
			setFormData({
				categoryId: "",
				startDate: "",
				startPeriod: "full_day",
				endDate: "",
				endPeriod: "full_day",
				notes: "",
			});
			onSuccess?.();
		} else {
			toast.error(
				result.error || t("absences.toast.requestFailed", "Failed to submit absence request"),
			);
		}
	};

	// Format days display (handle half days)
	const formatDays = (days: number) => {
		if (days === 1) return t("common.days.one", "1 day");
		if (days === 0.5) return t("common.days.half", "0.5 day");
		if (Number.isInteger(days)) return t("common.days.count", "{count} days", { count: days });
		return t("common.days.count", "{count} days", { count: days });
	};

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
				<form onSubmit={handleSubmit}>
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
						<div className="grid gap-2">
							<Label htmlFor="category">{t("absences.form.absenceType", "Absence Type *")}</Label>
							<Select
								value={formData.categoryId}
								onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
							>
								<SelectTrigger id="category">
									<SelectValue
										placeholder={t("absences.form.selectAbsenceType", "Select absence type")}
									/>
								</SelectTrigger>
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
						</div>

						{/* Start Date and Period */}
						<div className="grid gap-2">
							<Label>{t("absences.form.startDate", "Start Date *")}</Label>
							<div className="grid grid-cols-2 gap-2">
								<Input
									id="startDate"
									type="date"
									value={formData.startDate}
									onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
									required
								/>
								<Select
									value={formData.startPeriod}
									onValueChange={(value) =>
										setFormData({ ...formData, startPeriod: value as DayPeriod })
									}
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
							</div>
						</div>

						{/* End Date and Period */}
						<div className="grid gap-2">
							<Label>{t("absences.form.endDate", "End Date *")}</Label>
							<div className="grid grid-cols-2 gap-2">
								<Input
									id="endDate"
									type="date"
									value={formData.endDate}
									min={formData.startDate}
									onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
									required
								/>
								<Select
									value={formData.endPeriod}
									onValueChange={(value) =>
										setFormData({ ...formData, endPeriod: value as DayPeriod })
									}
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

						{/* Business Days Calculation */}
						{requestedDays > 0 && (
							<div className="rounded-md border p-3 text-sm">
								<div className="flex justify-between items-center">
									<span className="text-muted-foreground">
										{t("absences.form.businessDays", "Business days:")}
									</span>
									<span className="font-semibold tabular-nums">{formatDays(requestedDays)}</span>
								</div>
								{selectedCategory?.countsAgainstVacation && (
									<>
										<div className="flex justify-between items-center mt-1">
											<span className="text-muted-foreground">
												{t("absences.form.daysRemaining", "Days remaining:")}
											</span>
											<span className="font-semibold tabular-nums">
												{formatDays(remainingDays)}
											</span>
										</div>
										<div className="flex justify-between items-center mt-1 pt-2 border-t">
											<span className="font-medium">
												{t("absences.form.balanceAfterRequest", "Balance after request:")}
											</span>
											<span
												className={`font-bold tabular-nums ${insufficientBalance ? "text-destructive" : ""}`}
											>
												{formatDays(balanceAfterRequest)}
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
						)}

						{/* Notes */}
						<div className="grid gap-2">
							<Label htmlFor="notes">{t("absences.form.notesOptional", "Notes (Optional)")}</Label>
							<Textarea
								id="notes"
								placeholder={t(
									"absences.form.notesPlaceholder",
									"Add any additional information...",
								)}
								value={formData.notes}
								onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
								rows={3}
							/>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading || insufficientBalance || invalidSameDayPeriod}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("absences.form.submitRequest", "Submit Request")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
