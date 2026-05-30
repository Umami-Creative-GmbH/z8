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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { sickDetailOptions } from "@/lib/absences/sick-details";
import type { AbsenceDurationKind, SickDetail } from "@/lib/absences/types";
import { useRouter } from "@/navigation";
import { recordAbsenceForEmployee } from "./actions";
import {
	buildRecordAbsenceForEmployeeInput,
	getDefaultRecordAbsenceFormValues,
	validateRecordAbsenceFormDateRange,
} from "./record-absence-form-utils";

type AbsenceCategoryOption = {
	id: string;
	name: string;
	type: string;
	color: string | null;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
};

type RecordAbsenceDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	employee: { id: string; name: string } | null;
	categories: AbsenceCategoryOption[];
};

export function RecordAbsenceDialog({
	open,
	onOpenChange,
	employee,
	categories,
}: RecordAbsenceDialogProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [dateRangeError, setDateRangeError] = useState<string | null>(null);
	function requiredMessage(label: string) {
		return t("team.absences.recordDialog.required", "{label} is required", { label });
	}

	const title = employee
		? t("team.absences.recordDialog.titleForEmployee", "Record absence for {name}", {
				name: employee.name,
			})
		: t("team.absences.recordDialog.title", "Record absence");
	const durationOptions: Array<{ value: AbsenceDurationKind; label: string }> = [
		{ value: "full_day", label: t("absences.form.duration.fullDay", "Full day") },
		{ value: "partial_day", label: t("absences.form.duration.partialDay", "Partial day") },
	];
	const formDefaultValues = getDefaultRecordAbsenceFormValues();

	const form = useForm({
		defaultValues: formDefaultValues,
		onSubmit: async ({ value }) => {
			const rangeError = validateRecordAbsenceFormDateRange(value);
			if (rangeError) {
				setDateRangeError(rangeError);
				toast.error(rangeError);
				return;
			}

			setDateRangeError(null);

			if (!employee) {
				toast.error(
					t(
						"team.absences.recordDialog.noEmployee",
						"Select an employee before recording an absence",
					),
				);
				return;
			}

			const result = await recordAbsenceForEmployee(
				buildRecordAbsenceForEmployeeInput(employee.id, value),
			);

			if (result.success) {
				toast.success(t("team.absences.recordDialog.success", "Absence recorded"));
				form.reset(formDefaultValues);
				setDateRangeError(null);
				onOpenChange(false);
				refresh();
				return;
			}

			toast.error(
				result.error ?? t("team.absences.recordDialog.failure", "Failed to record absence"),
			);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			form.reset(formDefaultValues);
			setDateRangeError(null);
		}
		onOpenChange(nextOpen);
	}

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>{title}</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"team.absences.recordDialog.description",
								"Record an approved absence directly for the selected employee.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-5">
						<form.Field
							name="categoryId"
							validators={{
								onChange: ({ value }) =>
									value
										? undefined
										: requiredMessage(t("team.absences.recordDialog.category", "Category")),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("team.absences.recordDialog.category", "Category")}
									</TFormLabel>
									<Select
										name="categoryId"
										value={field.state.value}
										onValueChange={(value) => {
											field.handleChange(value);
											const nextCategory = categories.find((category) => category.id === value);
											if (nextCategory?.type !== "sick") {
												form.setFieldValue("sickDetail", "");
											}
										}}
										disabled={categories.length === 0}
									>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue
													placeholder={t(
														"team.absences.recordDialog.categoryPlaceholder",
														"Select an absence category…",
													)}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{categories.length === 0 ? (
												<SelectItem value="__no-categories" disabled>
													{t("team.absences.recordDialog.noCategories", "No categories available")}
												</SelectItem>
											) : (
												categories.map((category) => (
													<SelectItem key={category.id} value={category.id}>
														{category.name}
													</SelectItem>
												))
											)}
										</SelectContent>
									</Select>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.categoryId}>
							{(categoryId) => {
								const selectedCategory = categories.find((category) => category.id === categoryId);
								if (selectedCategory?.type !== "sick") return null;

								return (
									<form.Field
										name="sickDetail"
										validators={{
											onChange: ({ value }) =>
												value
													? undefined
													: requiredMessage(
															t("team.absences.recordDialog.sickDetail", "Sick detail"),
														),
										}}
									>
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)} required>
													{t("team.absences.recordDialog.sickDetail", "Sick detail")}
												</TFormLabel>
												<Select
													name="sickDetail"
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value as SickDetail)}
												>
													<TFormControl hasError={fieldHasError(field)}>
														<SelectTrigger className="w-full" onBlur={field.handleBlur}>
															<SelectValue
																placeholder={t(
																	"team.absences.recordDialog.sickDetailPlaceholder",
																	"Select sick detail…",
																)}
															/>
														</SelectTrigger>
													</TFormControl>
													<SelectContent>
														{sickDetailOptions.map((option) => (
															<SelectItem key={option.value} value={option.value}>
																{t(option.labelKey, option.label)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								);
							}}
						</form.Subscribe>

						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field
								name="startDate"
								validators={{
									onChange: ({ value }) =>
										value
											? undefined
											: requiredMessage(t("team.absences.recordDialog.startDate", "Start date")),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)} required>
											{t("team.absences.recordDialog.startDate", "Start date")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<DatePicker
												name="startDate"
												value={field.state.value}
												onChange={(value) => field.handleChange(value)}
												onBlur={field.handleBlur}
												placeholder={t(
													"team.absences.recordDialog.pickStartDate",
													"Pick start date…",
												)}
												required
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="endDate">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("team.absences.recordDialog.endDate", "End date")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<DatePicker
												name="endDate"
												value={field.state.value}
												onChange={(value) => field.handleChange(value)}
												onBlur={field.handleBlur}
												placeholder={t("team.absences.recordDialog.pickEndDate", "Pick end date…")}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<p className="-mt-2 text-muted-foreground text-xs sm:col-start-2">
								{t(
									"team.absences.recordDialog.endDateHelper",
									"Leave empty for a same-day absence.",
								)}
							</p>
						</div>

						<form.Field name="durationKind">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("absences.form.duration", "Absence duration")}</TFormLabel>
									<Select
										name="durationKind"
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as AbsenceDurationKind)}
									>
										<TFormControl>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{durationOptions.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.durationKind}>
							{(durationKind) =>
								durationKind === "partial_day" ? (
									<div className="grid gap-4 sm:grid-cols-2">
										<form.Field name="startTime">
											{(field) => (
												<TFormItem>
													<TFormLabel hasError={fieldHasError(field)} required>
														{t("absences.form.startTime", "Start time")}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															name="startTime"
															type="time"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															required
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											)}
										</form.Field>

										<form.Field name="endTime">
											{(field) => (
												<TFormItem>
													<TFormLabel hasError={fieldHasError(field)} required>
														{t("absences.form.endTime", "End time")}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															name="endTime"
															type="time"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															required
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											)}
										</form.Field>
									</div>
								) : null
							}
						</form.Subscribe>

						<form.Field name="notes">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("team.absences.recordDialog.notes", "Notes")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="notes"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"team.absences.recordDialog.notesPlaceholder",
												"Add internal context for this record…",
											)}
											rows={3}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{dateRangeError ? (
							<p
								role="alert"
								aria-live="polite"
								className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
							>
								{dateRangeError}
							</p>
						) : null}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting || !employee}>
									{isSubmitting ? (
										<>
											<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
											{t("team.absences.recordDialog.recording", "Recording…")}
										</>
									) : (
										t("team.absences.recordDialog.submit", "Record absence")
									)}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
