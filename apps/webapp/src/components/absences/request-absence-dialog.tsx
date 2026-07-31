"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getAbsencePlanPreview,
	requestAbsence,
} from "@/app/[locale]/(app)/absences/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
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
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { formatDays } from "@/lib/absences/date-utils";
import {
	calculateAbsenceDurationDays,
	normalizeAbsenceDurationInput,
	validateAbsenceDurationInput,
} from "@/lib/absences/duration";
import { sickDetailOptions } from "@/lib/absences/sick-details";
import type {
	AbsenceDurationKind,
	DayPeriod,
	Holiday,
	SickDetail,
} from "@/lib/absences/types";
import { queryKeys } from "@/lib/query/keys";
import { useRouter } from "@/navigation";
import { AbsencePlanPreviewPanel } from "./absence-plan-preview-panel";
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
	organizationId: string;
	remainingDays: number;
	holidays?: Holiday[];
	trigger?: React.ReactNode;
	onSuccess?: () => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	initialDate?: string;
}

const createDefaultValues = (initialDate?: string) => ({
	categoryId: "",
	startDate: initialDate || "",
	startPeriod: "full_day" as DayPeriod,
	endDate: initialDate || "",
	endPeriod: "full_day" as DayPeriod,
	durationKind: "full_day" as AbsenceDurationKind,
	startTime: "",
	endTime: "",
	notes: "",
	sickDetail: "" as SickDetail | "",
});

type RequestAbsenceFormValues = ReturnType<typeof createDefaultValues>;

const EMPTY_HOLIDAYS: Holiday[] = [];
const PARTIAL_DAY_TIME_ERRORS = new Set([
	"Enter a start time and end time for a partial-day absence.",
	"Enter times in HH:mm format.",
	"Enter an end time after the start time, or choose the next end date for an overnight absence.",
]);

function useRequestAbsenceDialogController({
	categories,
	controlledOnOpenChange,
	controlledOpen,
	holidays,
	initialDate,
	onSuccess,
	organizationId,
	remainingDays,
}: {
	categories: RequestAbsenceDialogProps["categories"];
	controlledOnOpenChange: RequestAbsenceDialogProps["onOpenChange"];
	controlledOpen: RequestAbsenceDialogProps["open"];
	holidays: Holiday[];
	initialDate: RequestAbsenceDialogProps["initialDate"];
	onSuccess: RequestAbsenceDialogProps["onSuccess"];
	organizationId: string;
	remainingDays: number;
}) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [internalOpen, setInternalOpen] = useState(false);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = (nextOpen: boolean) => {
		if (nextOpen) {
			form.reset(createDefaultValues(initialDate));
		} else {
			form.reset();
		}
		if (isControlled) {
			controlledOnOpenChange?.(nextOpen);
			return;
		}
		setInternalOpen(nextOpen);
	};
	const form = useForm({
		defaultValues: createDefaultValues(initialDate),
		onSubmit: async ({ value }) => {
			const validationError = validateAbsenceDurationInput(value);
			if (validationError) {
				toast.error(validationError);
				return;
			}
			const normalized = normalizeAbsenceDurationInput(value);
			const selectedCategory = categories.find(
				(category) => category.id === normalized.categoryId,
			);
			const requiredFieldsMessage = t(
				"absences.form.errors.fillRequiredFields",
				"Please fill in all required fields",
			);
			if (selectedCategory?.type === "sick" && !value.sickDetail) {
				toast.error(requiredFieldsMessage);
				return;
			}
			if (selectedCategory?.type !== "sick" && value.sickDetail) {
				toast.error(
					t(
						"absences.form.errors.invalidSelection",
						"Please check your selection and try again",
					),
				);
				return;
			}
			const requestedDays = calculateAbsenceDurationDays(normalized, holidays);
			const balanceAfterRequest = selectedCategory?.countsAgainstVacation
				? remainingDays - requestedDays
				: remainingDays;
			if (selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0) {
				toast.error(
					t(
						"absences.form.errors.insufficientBalance",
						"Insufficient vacation balance",
					),
				);
				return;
			}
			const result = await requestAbsence({
				categoryId: normalized.categoryId,
				startDate: normalized.startDate,
				startPeriod: normalized.startPeriod,
				endDate: normalized.endDate,
				endPeriod: normalized.endPeriod,
				durationKind: normalized.durationKind,
				startTime: normalized.startTime,
				endTime: normalized.endTime,
				notes: normalized.notes || undefined,
				...(value.sickDetail ? { sickDetail: value.sickDetail } : {}),
			});
			if (result.success) {
				toast.success(
					t(
						"absences.toast.requestSubmitted",
						"Absence request submitted successfully",
					),
				);
				setOpen(false);
				form.reset();
				refresh();
				onSuccess?.();
			} else {
				toast.error(
					result.error ||
						t(
							"absences.toast.requestFailed",
							"Failed to submit absence request",
						),
				);
			}
		},
	});
	const planPreviewValues = useStore(form.store, (state) => {
		const normalized = normalizeAbsenceDurationInput(state.values);
		return {
			categoryId: normalized.categoryId,
			startDate: normalized.startDate,
			startPeriod: normalized.startPeriod,
			endDate: normalized.endDate,
			endPeriod: normalized.endPeriod,
			durationKind: normalized.durationKind,
			startTime: normalized.startTime,
			endTime: normalized.endTime,
		};
	});
	const selectedCategoryId = useStore(
		form.store,
		(state) => state.values.categoryId,
	);
	const selectedCategory = categories.find(
		(category) => category.id === selectedCategoryId,
	);
	const canLoadPlanPreview = Boolean(
		open &&
			planPreviewValues.categoryId &&
			planPreviewValues.startDate &&
			planPreviewValues.endDate,
	);
	const planPreviewQuery = useQuery({
		queryKey: queryKeys.absencePlanPreview.detail(
			organizationId,
			planPreviewValues,
		),
		queryFn: async () => {
			const result = await getAbsencePlanPreview(planPreviewValues);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: canLoadPlanPreview,
	});
	return {
		canLoadPlanPreview,
		form,
		isControlled,
		open,
		planPreviewQuery,
		setOpen,
		showSickDetail: selectedCategory?.type === "sick",
		t,
	};
}

type RequestAbsenceFormApi = ReturnType<
	typeof useRequestAbsenceDialogController
>["form"];

export function RequestAbsenceDialog({
	categories,
	organizationId,
	remainingDays,
	holidays = EMPTY_HOLIDAYS,
	trigger,
	onSuccess,
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	initialDate,
}: RequestAbsenceDialogProps) {
	const {
		canLoadPlanPreview,
		form,
		isControlled,
		open,
		planPreviewQuery,
		setOpen,
		showSickDetail,
		t,
	} = useRequestAbsenceDialogController({
		categories,
		controlledOnOpenChange,
		controlledOpen,
		holidays,
		initialDate,
		onSuccess,
		organizationId,
		remainingDays,
	});

	const showTrigger = !isControlled || trigger;

	return (
		<ActionPanel open={open} onOpenChange={setOpen}>
			{showTrigger && (
				<ActionPanelTrigger asChild>
					{trigger || (
						<Button>{t("absences.requestAbsence", "Request Absence")}</Button>
					)}
				</ActionPanelTrigger>
			)}
			<ActionPanelContent>
				<form
					action={() => {
						void form.handleSubmit();
					}}
					onSubmit={(event) => {
						event.stopPropagation();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("absences.form.title", "Request Absence")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"absences.form.description",
								"Submit a request for time off. Your manager will be notified for approval.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
						<RequestAbsenceCategoryFields
							categories={categories}
							form={form}
							showSickDetail={showSickDetail}
						/>
						<RequestAbsenceDurationFields form={form} />
						<RequestAbsenceSummaryAndNotes
							canLoadPlanPreview={canLoadPlanPreview}
							categories={categories}
							form={form}
							holidays={holidays}
							planPreviewQuery={planPreviewQuery}
							remainingDays={remainingDays}
						/>
					</ActionPanelBody>

					<form.Subscribe<{
						isSubmitting: boolean;
						values: RequestAbsenceFormValues;
					}>
						selector={(state) => ({
							isSubmitting: state.isSubmitting,
							values: state.values,
						})}
					>
						{({
							isSubmitting,
							values,
						}: {
							isSubmitting: boolean;
							values: RequestAbsenceFormValues;
						}) => {
							const normalizedValues = normalizeAbsenceDurationInput(values);
							const validationError = validateAbsenceDurationInput(values);
							const requestedDays =
								values.categoryId && values.startDate && !validationError
									? calculateAbsenceDurationDays(normalizedValues, holidays)
									: 0;
							const selectedCategory = categories.find(
								(c) => c.id === normalizedValues.categoryId,
							);
							const balanceAfterRequest =
								selectedCategory?.countsAgainstVacation
									? remainingDays - requestedDays
									: remainingDays;
							const insufficientBalance =
								selectedCategory?.countsAgainstVacation &&
								balanceAfterRequest < 0;
							return (
								<ActionPanelFooter>
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
										disabled={
											isSubmitting ||
											insufficientBalance ||
											Boolean(validationError)
										}
									>
										{isSubmitting && (
											<IconLoader2 className="mr-2 size-4 animate-spin" />
										)}
										{t("absences.form.submitRequest", "Submit Request")}
									</Button>
								</ActionPanelFooter>
							);
						}}
					</form.Subscribe>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function RequestAbsenceCategoryFields({
	categories,
	form,
	showSickDetail,
}: {
	categories: RequestAbsenceDialogProps["categories"];
	form: RequestAbsenceFormApi;
	showSickDetail: boolean;
}) {
	const { t } = useTranslate();
	return (
		<>
			<form.Field name="categoryId">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={field.state.meta.errors.length > 0}>
							{t("absences.form.absenceType", "Absence Type *")}
						</TFormLabel>
						<Select
							value={field.state.value}
							onValueChange={(value) => {
								field.handleChange(value);
								if (
									categories.find((category) => category.id === value)?.type !==
									"sick"
								) {
									form.setFieldValue("sickDetail", "");
								}
							}}
						>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<SelectTrigger
									aria-label={t("absences.form.absenceType", "Absence Type *")}
								>
									<SelectValue
										placeholder={t(
											"absences.form.selectAbsenceType",
											"Select absence type",
										)}
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
			{showSickDetail && (
				<form.Field name="sickDetail">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
								{t("absences.form.sickDetail", "Sick detail *")}
							</TFormLabel>
							<Select
								value={field.state.value}
								onValueChange={(value) =>
									field.handleChange(value as typeof field.state.value)
								}
							>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<SelectTrigger
										aria-label={t("absences.form.sickDetail", "Sick detail *")}
									>
										<SelectValue
											placeholder={t(
												"absences.form.sickDetailPlaceholder",
												"Select sick detail",
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
			)}
		</>
	);
}

function RequestAbsenceDurationFields({
	form,
}: {
	form: RequestAbsenceFormApi;
}) {
	const { t } = useTranslate();
	const durationOptions = [
		{
			value: "full_day",
			label: t("absences.form.duration.fullDay", "Full day"),
		},
		{
			value: "partial_day",
			label: t("absences.form.duration.partialDay", "Partial day"),
		},
	];
	return (
		<>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="startDate">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
								{t("absences.form.startDate", "Start Date *")}
							</TFormLabel>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<DatePicker
									aria-label={t("absences.form.startDate", "Start Date *")}
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
									required
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Subscribe<RequestAbsenceFormValues["startDate"]>
					selector={(state) => state.values.startDate}
				>
					{(startDate: RequestAbsenceFormValues["startDate"]) => (
						<form.Field name="endDate">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={field.state.meta.errors.length > 0}>
										{t("absences.form.endDate", "End Date")}
									</TFormLabel>
									<TFormControl hasError={field.state.meta.errors.length > 0}>
										<DatePicker
											aria-label={t("absences.form.endDate", "End Date")}
											value={field.state.value}
											min={startDate}
											onChange={field.handleChange}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					)}
				</form.Subscribe>
				<p className="-mt-2 text-xs text-muted-foreground sm:col-start-2">
					{t(
						"absences.form.endDateHelper",
						"Leave empty for a same-day absence.",
					)}
				</p>
			</div>
			<form.Field name="durationKind">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("absences.form.duration", "Absence Duration")}
						</TFormLabel>
						<Select
							value={field.state.value}
							onValueChange={(value) =>
								field.handleChange(value as AbsenceDurationKind)
							}
						>
							<TFormControl>
								<SelectTrigger
									aria-label={t("absences.form.duration", "Absence Duration")}
								>
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
			<form.Subscribe<RequestAbsenceFormValues["durationKind"]>
				selector={(state) => state.values.durationKind}
			>
				{(durationKind: RequestAbsenceFormValues["durationKind"]) =>
					durationKind === "partial_day" ? (
						<PartialDayTimeFields form={form} />
					) : null
				}
			</form.Subscribe>
			<form.Subscribe<RequestAbsenceFormValues>
				selector={(state) => state.values}
			>
				{(values: RequestAbsenceFormValues) => {
					const validationError = validateAbsenceDurationInput(values);
					if (
						values.durationKind !== "partial_day" ||
						!validationError ||
						!PARTIAL_DAY_TIME_ERRORS.has(validationError)
					)
						return null;
					return (
						<p
							aria-live="polite"
							className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
							role="alert"
						>
							{validationError}
						</p>
					);
				}}
			</form.Subscribe>
		</>
	);
}

function PartialDayTimeFields({ form }: { form: RequestAbsenceFormApi }) {
	const { t } = useTranslate();
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{(["startTime", "endTime"] as const).map((name) => (
				<form.Field key={name} name={name}>
					{(field) => {
						const label =
							name === "startTime"
								? t("absences.form.startTime", "Start Time *")
								: t("absences.form.endTime", "End Time *");
						return (
							<TFormItem>
								<TFormLabel hasError={field.state.meta.errors.length > 0}>
									{label}
								</TFormLabel>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<Input
										aria-label={label}
										type="time"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										required
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						);
					}}
				</form.Field>
			))}
		</div>
	);
}

function RequestAbsenceSummaryAndNotes({
	canLoadPlanPreview,
	categories,
	form,
	holidays,
	planPreviewQuery,
	remainingDays,
}: {
	canLoadPlanPreview: boolean;
	categories: RequestAbsenceDialogProps["categories"];
	form: RequestAbsenceFormApi;
	holidays: Holiday[];
	planPreviewQuery: ReturnType<
		typeof useRequestAbsenceDialogController
	>["planPreviewQuery"];
	remainingDays: number;
}) {
	const { t } = useTranslate();
	return (
		<>
			<form.Subscribe<RequestAbsenceFormValues>
				selector={(state) => state.values}
			>
				{(values: RequestAbsenceFormValues) => {
					const normalized = normalizeAbsenceDurationInput(values);
					const validationError = validateAbsenceDurationInput(values);
					const requestedDays =
						values.categoryId && values.startDate && !validationError
							? calculateAbsenceDurationDays(normalized, holidays)
							: 0;
					const selectedCategory = categories.find(
						(category) => category.id === normalized.categoryId,
					);
					if (requestedDays <= 0) return null;
					const balanceAfterRequest = selectedCategory?.countsAgainstVacation
						? remainingDays - requestedDays
						: remainingDays;
					const insufficientBalance =
						selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0;
					return (
						<div className="rounded-md border p-3 text-sm">
							<BalanceRow
								className=""
								label={t("absences.form.businessDays", "Business days:")}
								value={formatDays(requestedDays, t)}
							/>
							{selectedCategory?.countsAgainstVacation && (
								<>
									<BalanceRow
										label={t("absences.form.daysRemaining", "Days remaining:")}
										value={formatDays(remainingDays, t)}
									/>
									<BalanceRow
										className="mt-1 pt-2 border-t"
										label={t(
											"absences.form.balanceAfterRequest",
											"Balance after request:",
										)}
										labelClassName="font-medium"
										value={formatDays(balanceAfterRequest, t)}
										valueClassName={`font-bold ${insufficientBalance ? "text-destructive" : ""}`}
									/>
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
			{canLoadPlanPreview && (
				<AbsencePlanPreviewPanel
					preview={planPreviewQuery.data}
					isLoading={planPreviewQuery.isLoading}
					error={
						planPreviewQuery.isError ? planPreviewQuery.error.message : null
					}
				/>
			)}
			<form.Field name="notes">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("absences.form.notesOptional", "Notes (Optional)")}
						</TFormLabel>
						<TFormControl>
							<Textarea
								placeholder={t(
									"absences.form.notesPlaceholder",
									"Add any additional information...",
								)}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								rows={3}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
		</>
	);
}

function BalanceRow({
	className = "mt-1",
	label,
	labelClassName = "text-muted-foreground",
	value,
	valueClassName,
}: {
	className?: string;
	label: string;
	labelClassName?: string;
	value: string;
	valueClassName?: string;
}) {
	return (
		<div className={`flex justify-between items-center ${className}`}>
			<span className={labelClassName}>{label}</span>
			<span className={`tabular-nums ${valueClassName ?? "font-semibold"}`}>
				{value}
			</span>
		</div>
	);
}
