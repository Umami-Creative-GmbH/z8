"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import type { DayPeriod } from "@/lib/absences/types";
import { useRouter } from "@/navigation";
import { recordAbsenceForEmployee } from "./actions";

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

type RecordAbsenceFormValues = {
	categoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	notes: string;
};

const defaultValues: RecordAbsenceFormValues = {
	categoryId: "",
	startDate: "",
	startPeriod: "am",
	endDate: "",
	endPeriod: "pm",
	notes: "",
};

function requiredMessage(label: string) {
	return `${label} is required`;
}

export function RecordAbsenceDialog({
	open,
	onOpenChange,
	employee,
	categories,
}: RecordAbsenceDialogProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const title = employee
		? `Record absence for ${employee.name}`
		: t("team.absences.recordDialog.title", "Record absence");

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (!employee) {
				toast.error(
					t(
						"team.absences.recordDialog.noEmployee",
						"Select an employee before recording an absence",
					),
				);
				return;
			}

			const result = await recordAbsenceForEmployee({
				employeeId: employee.id,
				categoryId: value.categoryId,
				startDate: value.startDate,
				startPeriod: value.startPeriod,
				endDate: value.endDate,
				endPeriod: value.endPeriod,
				notes: value.notes.trim() || undefined,
			});

			if (result.success) {
				toast.success(t("team.absences.recordDialog.success", "Absence recorded"));
				form.reset(defaultValues);
				onOpenChange(false);
				router.refresh();
				return;
			}

			toast.error(
				result.error ?? t("team.absences.recordDialog.failure", "Failed to record absence"),
			);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			form.reset(defaultValues);
		}
		onOpenChange(nextOpen);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						{t(
							"team.absences.recordDialog.description",
							"Record an approved absence directly for the selected employee.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					className="grid gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
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
									onValueChange={(value) => field.handleChange(value)}
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
											placeholder={t("team.absences.recordDialog.pickStartDate", "Pick start date")}
											required
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="startPeriod">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("team.absences.recordDialog.startPeriod", "Start period")}
									</TFormLabel>
									<Select
										name="startPeriod"
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as DayPeriod)}
									>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value="am">
												{t("team.absences.recordDialog.morning", "Morning")}
											</SelectItem>
											<SelectItem value="pm">
												{t("team.absences.recordDialog.afternoon", "Afternoon")}
											</SelectItem>
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field
							name="endDate"
							validators={{
								onChange: ({ value }) =>
									value
										? undefined
										: requiredMessage(t("team.absences.recordDialog.endDate", "End date")),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("team.absences.recordDialog.endDate", "End date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<DatePicker
											name="endDate"
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
											onBlur={field.handleBlur}
											placeholder={t("team.absences.recordDialog.pickEndDate", "Pick end date")}
											required
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="endPeriod">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("team.absences.recordDialog.endPeriod", "End period")}
									</TFormLabel>
									<Select
										name="endPeriod"
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as DayPeriod)}
									>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value="am">
												{t("team.absences.recordDialog.morning", "Morning")}
											</SelectItem>
											<SelectItem value="pm">
												{t("team.absences.recordDialog.afternoon", "Afternoon")}
											</SelectItem>
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
					</div>

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

					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								{t("common.cancel", "Cancel")}
							</Button>
						</DialogClose>
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
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
