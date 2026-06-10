"use client";

import { IconCalendar, IconCheck, IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";

type ContractType = UpsertEmploymentHistory["contractType"];
type ReviewState = UpsertEmploymentHistory["reviewState"];
type WorkModel = UpsertEmploymentHistory["workModel"];

export type EmploymentHistoryWorkPolicyOption = {
	id: string;
	name: string;
};

export type EmploymentHistoryEntry = {
	id: string;
	validFrom: Date | string;
	validUntil: Date | string | null;
	status: string;
	contractType: ContractType;
	weeklyContractMinutes: number;
	probationStartsOn: Date | string | null;
	probationEndsOn: Date | string | null;
	workModel: WorkModel;
	workPolicyId: string | null;
	workPolicy?: EmploymentHistoryWorkPolicyOption | null;
	hourlyRate: string | null;
	currency: string;
	changeReason: string | null;
	reviewState: ReviewState;
	confirmedAt?: Date | string | null;
};

type MutationResult<T = unknown> = { success: boolean; data?: T; error?: string };

export type EmployeeEmploymentHistoryCardProps = {
	history: EmploymentHistoryEntry[];
	canManage: boolean;
	onCreate: (data: UpsertEmploymentHistory) => Promise<MutationResult>;
	onConfirm: (historyId: string) => Promise<MutationResult>;
	onCancel: (historyId: string) => Promise<MutationResult>;
	isCreating: boolean;
	isMutating: boolean;
	workPolicies?: EmploymentHistoryWorkPolicyOption[];
};

const EMPTY_WORK_POLICIES: EmploymentHistoryWorkPolicyOption[] = [];

type FormValues = {
	validFrom: string;
	reviewState: ReviewState;
	weeklyHours: string;
	workModel: WorkModel;
	contractType: ContractType;
	workPolicyId: string;
	hourlyRate: string;
	probationStartsOn: string;
	probationEndsOn: string;
	changeReason: string;
};

type EmploymentHistoryFormApi = ReactFormExtendedApi<
	FormValues,
	FormValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	FormAsyncValidateOrFn<FormValues> | undefined,
	unknown
>;

const defaultFormValues: FormValues = {
	validFrom: "",
	reviewState: "draft",
	weeklyHours: "40",
	workModel: "onsite",
	contractType: "fixed",
	workPolicyId: "__inherit__",
	hourlyRate: "",
	probationStartsOn: "",
	probationEndsOn: "",
	changeReason: "",
};

function toDateTime(value: Date | string | null | undefined) {
	if (!value) return null;
	return value instanceof Date
		? DateTime.fromJSDate(value, { zone: "utc" })
		: DateTime.fromISO(value, { zone: "utc" });
}

function dateInputToDate(value: string) {
	return DateTime.fromISO(value, { zone: "utc" }).toJSDate();
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string) {
	const cachedFormatter = currencyFormatters.get(currency);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.NumberFormat(undefined, { style: "currency", currency });
	currencyFormatters.set(currency, formatter);
	return formatter;
}

function formatDate(value: Date | string | null | undefined) {
	const date = toDateTime(value);
	return date?.isValid ? date.toLocaleString(DateTime.DATE_MED) : null;
}

function formatCurrency(amount: string | null, currency: string) {
	if (!amount) return null;
	return getCurrencyFormatter(currency).format(Number(amount));
}

function formatWeeklyHours(minutes: number) {
	const hours = minutes / 60;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function isCurrentConfirmed(entry: EmploymentHistoryEntry, now: DateTime) {
	if (entry.reviewState !== "confirmed") return false;
	const validFrom = toDateTime(entry.validFrom);
	const validUntil = toDateTime(entry.validUntil);
	return !!validFrom?.isValid && validFrom <= now && (!validUntil?.isValid || validUntil > now);
}

function isFutureConfirmed(entry: EmploymentHistoryEntry, now: DateTime) {
	const validFrom = toDateTime(entry.validFrom);
	return entry.reviewState === "confirmed" && !!validFrom?.isValid && validFrom > now;
}

function canConfirm(entry: EmploymentHistoryEntry) {
	return entry.reviewState === "draft" || entry.reviewState === "pending";
}

function canCancel(entry: EmploymentHistoryEntry, now: DateTime) {
	const validFrom = toDateTime(entry.validFrom);
	return canConfirm(entry) || (!!validFrom?.isValid && validFrom > now);
}

export function EmployeeEmploymentHistoryCard({
	history,
	canManage,
	onCreate,
	onConfirm,
	onCancel,
	isCreating,
	isMutating,
	workPolicies = EMPTY_WORK_POLICIES,
}: EmployeeEmploymentHistoryCardProps) {
	const { t } = useTranslate();
	const [isAdding, setIsAdding] = useState(false);
	const now = DateTime.utc();
	const sortedHistory = history.toSorted((a, b) => {
		const aDate = toDateTime(a.validFrom)?.toMillis() ?? 0;
		const bDate = toDateTime(b.validFrom)?.toMillis() ?? 0;
		return bDate - aDate;
	});
	const policyNameById = new Map(workPolicies.map((policy) => [policy.id, policy.name]));
	const current = sortedHistory.find((entry) => isCurrentConfirmed(entry, now));
	const nextConfirmed = sortedHistory
		.filter((entry) => isFutureConfirmed(entry, now))
		.toSorted((a, b) => {
			const aDate = toDateTime(a.validFrom)?.toMillis() ?? 0;
			const bDate = toDateTime(b.validFrom)?.toMillis() ?? 0;
			return aDate - bDate;
		})[0];

	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmit: async ({ value }) => {
			const weeklyHours = Number(value.weeklyHours);
			const result = await onCreate({
				validFrom: dateInputToDate(value.validFrom),
				status: "active",
				contractType: value.contractType,
				weeklyContractMinutes: Number.isFinite(weeklyHours) ? Math.round(weeklyHours * 60) : 0,
				probationStartsOn: value.probationStartsOn
					? dateInputToDate(value.probationStartsOn)
					: null,
				probationEndsOn: value.probationEndsOn ? dateInputToDate(value.probationEndsOn) : null,
				workModel: value.workModel,
				workPolicyId: value.workPolicyId === "__inherit__" ? null : value.workPolicyId,
				hourlyRate: value.contractType === "hourly" ? value.hourlyRate : null,
				currency: "EUR",
				changeReason: value.changeReason.trim() || null,
				reviewState: value.reviewState,
			}).catch(() => null);

			if (!result) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}

			if (result.success) {
				toast.success(
					t("settings.employmentHistory.addSuccess", "Employment history change added"),
				);
				form.reset();
				setIsAdding(false);
				return;
			}

			toast.error(
				result.error ||
					t("settings.employmentHistory.addError", "Failed to add employment history change"),
			);
		},
	});

	const handleConfirm = async (historyId: string) => {
		const result = await onConfirm(historyId).catch(() => null);
		if (result?.success) {
			toast.success(
				t("settings.employmentHistory.confirmSuccess", "Employment history change confirmed"),
			);
			return;
		}
		toast.error(
			result?.error ||
				t("settings.employmentHistory.confirmError", "Failed to confirm employment history change"),
		);
	};

	const handleCancel = async (historyId: string) => {
		const confirmed = window.confirm(
			t(
				"settings.employmentHistory.cancelConfirm",
				"Cancel this employment change? This removes the scheduled or draft employment change.",
			),
		);
		if (!confirmed) return;

		const result = await onCancel(historyId).catch(() => null);
		if (result?.success) {
			toast.success(
				t("settings.employmentHistory.cancelSuccess", "Employment history change canceled"),
			);
			return;
		}
		toast.error(
			result?.error ||
				t("settings.employmentHistory.cancelError", "Failed to cancel employment history change"),
		);
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div>
					<CardTitle>{t("settings.employmentHistory.title", "Contract & Work Model")}</CardTitle>
					<CardDescription>
						{t(
							"settings.employmentHistory.description",
							"Confirmed context and scheduled employment changes",
						)}
					</CardDescription>
				</div>
				{canManage && (
					<Button
						size="sm"
						variant={isAdding ? "outline" : "default"}
						onClick={() => setIsAdding(!isAdding)}
					>
						<IconPlus className="mr-2 size-4" aria-hidden="true" />
						{t("settings.employmentHistory.addChange", "Add Change")}
					</Button>
				)}
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="grid gap-3 md:grid-cols-2">
					<ContextPanel
						label={t("settings.employmentHistory.currentConfirmed", "Current confirmed")}
						entry={current}
						empty={t(
							"settings.employmentHistory.noCurrentContext",
							"No confirmed contract context",
						)}
						t={t}
						policyNameById={policyNameById}
					/>
					<ContextPanel
						label={t(
							"settings.employmentHistory.nextScheduledConfirmed",
							"Next scheduled confirmed",
						)}
						entry={nextConfirmed}
						empty={t(
							"settings.employmentHistory.noScheduledChange",
							"No confirmed change scheduled",
						)}
						t={t}
						policyNameById={policyNameById}
					/>
				</div>

				{canManage && isAdding && (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							form.handleSubmit();
						}}
						className="rounded-lg border bg-muted/20 p-4"
					>
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							<DateField
								form={form}
								name="validFrom"
								label={t("settings.employmentHistory.effectiveDate", "Effective Date")}
								disabled={isCreating}
								description={t(
									"settings.employmentHistory.effectiveDateHelp",
									"When this contract context takes effect",
								)}
								requiredMessage={t(
									"settings.employmentHistory.effectiveDateRequired",
									"Effective Date is required",
								)}
								required
							/>
							<TextField
								form={form}
								name="weeklyHours"
								label={t("settings.employmentHistory.weeklyHours", "Weekly Hours")}
								type="number"
								disabled={isCreating}
							/>
							<form.Field name="reviewState">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.employmentHistory.reviewState", "Review State")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as ReviewState)}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.employmentHistory.selectReviewState",
															"Select review state",
														)}
													/>
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="draft">
													{t("settings.employmentHistory.states.draft", "draft")}
												</SelectItem>
												<SelectItem value="pending">
													{t("settings.employmentHistory.states.pending", "pending")}
												</SelectItem>
												<SelectItem value="confirmed">
													{t("settings.employmentHistory.states.confirmed", "confirmed")}
												</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="workModel">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.employmentHistory.workModel", "Work Model")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as WorkModel)}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.employmentHistory.selectWorkModel",
															"Select work model",
														)}
													/>
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="onsite">
													{t("settings.employmentHistory.workModels.onsite", "onsite")}
												</SelectItem>
												<SelectItem value="hybrid">
													{t("settings.employmentHistory.workModels.hybrid", "hybrid")}
												</SelectItem>
												<SelectItem value="remote">
													{t("settings.employmentHistory.workModels.remote", "remote")}
												</SelectItem>
												<SelectItem value="flexible">
													{t("settings.employmentHistory.workModels.flexible", "flexible")}
												</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="contractType">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.employmentHistory.contractType", "Contract Type")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as ContractType)}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.employmentHistory.selectContractType",
															"Select contract type",
														)}
													/>
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="fixed">
													{t("settings.employmentHistory.contractTypes.fixed", "fixed")}
												</SelectItem>
												<SelectItem value="hourly">
													{t("settings.employmentHistory.contractTypes.hourly", "hourly")}
												</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="workPolicyId">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.employmentHistory.workPolicy", "Work Policy")}
										</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={field.handleChange}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue
														placeholder={t(
															"settings.employmentHistory.selectWorkPolicy",
															"Select work policy",
														)}
													/>
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="__inherit__">
													{t(
														"settings.employmentHistory.inheritWorkPolicy",
														"Inherit team/org policy",
													)}
												</SelectItem>
												{workPolicies.map((policy) => (
													<SelectItem key={policy.id} value={policy.id}>
														{policy.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<TFormDescription>
											{t(
												"settings.employmentHistory.workPolicyHelp",
												"Overrides the selected policy for this employee during this contract period.",
											)}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<TextField
								form={form}
								name="hourlyRate"
								label={t("settings.employmentHistory.hourlyRate", "Hourly Rate")}
								type="number"
								disabled={isCreating}
							/>
							<DateField
								form={form}
								name="probationStartsOn"
								label={t("settings.employmentHistory.probationStart", "Probation Start")}
								disabled={isCreating}
							/>
							<DateField
								form={form}
								name="probationEndsOn"
								label={t("settings.employmentHistory.probationEnd", "Probation End")}
								disabled={isCreating}
							/>
						</div>
						<form.Field name="changeReason">
							{(field) => (
								<TFormItem className="mt-4">
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.employmentHistory.reasonNote", "Reason / Note")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="changeReason"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={isCreating}
											autoComplete="off"
											placeholder={t(
												"settings.employmentHistory.reasonPlaceholder",
												"Annual review, role change, or work-model update…",
											)}
											rows={2}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<div className="mt-4 flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsAdding(false)}
								disabled={isCreating}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isCreating}>
								{isCreating && (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								)}
								{t("settings.employmentHistory.saveChange", "Save Change")}
							</Button>
						</div>
					</form>
				)}

				<div className="space-y-3">
					<div className="text-sm font-medium">
						{t("settings.employmentHistory.timeline", "Timeline")}
					</div>
					{sortedHistory.length === 0 ? (
						<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
							{t(
								"settings.employmentHistory.emptyTimeline",
								"No contract or work-model history yet.",
							)}
						</div>
					) : (
						<div className="space-y-3">
							{sortedHistory.map((entry) => (
								<TimelineRow
									key={entry.id}
									entry={entry}
									canManage={canManage}
									isMutating={isMutating}
									now={now}
									onConfirm={handleConfirm}
									onCancel={handleCancel}
									t={t}
									policyNameById={policyNameById}
								/>
							))}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function ContextPanel({
	entry,
	label,
	empty,
	t,
	policyNameById,
}: {
	entry?: EmploymentHistoryEntry;
	label: string;
	empty: string;
	t: ReturnType<typeof useTranslate>["t"];
	policyNameById: Map<string, string>;
}) {
	const policyName =
		entry?.workPolicy?.name ?? (entry?.workPolicyId && policyNameById.get(entry.workPolicyId));

	return (
		<div className="rounded-lg border p-4">
			<div className="mb-2 text-sm text-muted-foreground">{label}</div>
			{entry ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="default">
							{t("settings.employmentHistory.weeklyHoursValue", "{hours} / week", {
								hours: formatWeeklyHours(entry.weeklyContractMinutes),
							})}
						</Badge>
						<Badge variant="outline">{entry.workModel}</Badge>
						<Badge variant="secondary">{entry.contractType}</Badge>
					</div>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<IconCalendar className="size-3" aria-hidden="true" />
						<span>
							{t("settings.employmentHistory.effectiveDateValue", "Effective {date}", {
								date: formatDate(entry.validFrom) ?? t("common.present", "Present"),
							})}
						</span>
					</div>
					{entry.contractType === "hourly" && entry.hourlyRate && (
						<div className="text-sm">
							{t("settings.employmentHistory.hourlyRateValue", "{rate} / hour", {
								rate: formatCurrency(entry.hourlyRate, entry.currency),
							})}
						</div>
					)}
					{policyName && (
						<div className="text-sm text-muted-foreground">
							{t("settings.employmentHistory.policyValue", "Policy: {policyName}", {
								policyName,
							})}
						</div>
					)}
				</div>
			) : (
				<div className="text-sm text-muted-foreground">{empty}</div>
			)}
		</div>
	);
}

function TimelineRow({
	entry,
	canManage,
	isMutating,
	now,
	onConfirm,
	onCancel,
	t,
	policyNameById,
}: {
	entry: EmploymentHistoryEntry;
	canManage: boolean;
	isMutating: boolean;
	now: DateTime;
	onConfirm: (historyId: string) => void;
	onCancel: (historyId: string) => void;
	t: ReturnType<typeof useTranslate>["t"];
	policyNameById: Map<string, string>;
}) {
	const current = isCurrentConfirmed(entry, now);
	const hourlyRate = formatCurrency(entry.hourlyRate, entry.currency);
	const policyName =
		entry.workPolicy?.name ?? (entry.workPolicyId && policyNameById.get(entry.workPolicyId));

	return (
		<div className="rounded-lg border p-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<span className={cn("font-medium", current && "text-primary")}>
							{t("settings.employmentHistory.weeklyHoursValue", "{hours} / week", {
								hours: formatWeeklyHours(entry.weeklyContractMinutes),
							})}
						</span>
						<Badge variant={entry.reviewState === "confirmed" ? "default" : "secondary"}>
							{entry.reviewState}
						</Badge>
						{current && <Badge variant="outline">{t("common.current", "Current")}</Badge>}
					</div>
					<div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
						<span>{entry.workModel}</span>
						<span aria-hidden="true">·</span>
						<span>{entry.contractType}</span>
						{hourlyRate && (
							<>
								<span aria-hidden="true">·</span>
								<span>
									{t("settings.employmentHistory.hourlyRateValue", "{rate} / hour", {
										rate: hourlyRate,
									})}
								</span>
							</>
						)}
					</div>
					<div className="text-xs text-muted-foreground">
						{formatDate(entry.validFrom)} -{" "}
						{entry.validUntil ? formatDate(entry.validUntil) : t("common.present", "Present")}
					</div>
					{entry.probationStartsOn && entry.probationEndsOn && (
						<div className="text-xs text-muted-foreground">
							{t("settings.employmentHistory.probationRange", "Probation {startDate} - {endDate}", {
								startDate: formatDate(entry.probationStartsOn) ?? "",
								endDate: formatDate(entry.probationEndsOn) ?? "",
							})}
						</div>
					)}
					{entry.changeReason && (
						<div className="text-sm text-muted-foreground">{entry.changeReason}</div>
					)}
					{policyName && (
						<div className="text-xs text-muted-foreground">
							{t("settings.employmentHistory.policyValue", "Policy: {policyName}", {
								policyName,
							})}
						</div>
					)}
				</div>
				{canManage && (canConfirm(entry) || canCancel(entry, now)) && (
					<div className="flex gap-2">
						{canConfirm(entry) && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => onConfirm(entry.id)}
								disabled={isMutating}
							>
								{isMutating ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconCheck className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("common.confirm", "Confirm")}
							</Button>
						)}
						{canCancel(entry, now) && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => onCancel(entry.id)}
								disabled={isMutating}
							>
								<IconX className="mr-2 size-4" aria-hidden="true" />
								{t("common.cancel", "Cancel")}
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function TextField({
	form,
	name,
	label,
	type = "text",
	disabled,
}: {
	form: EmploymentHistoryFormApi;
	name: "weeklyHours" | "hourlyRate";
	label: string;
	type?: string;
	disabled?: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<Input
							name={name}
							type={type}
							inputMode={type === "number" ? "decimal" : undefined}
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							disabled={disabled}
							autoComplete="off"
						/>
					</TFormControl>
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}

function DateField({
	form,
	name,
	label,
	disabled,
	description,
	requiredMessage,
	required,
}: {
	form: EmploymentHistoryFormApi;
	name: "validFrom" | "probationStartsOn" | "probationEndsOn";
	label: string;
	disabled?: boolean;
	description?: string;
	requiredMessage?: string;
	required?: boolean;
}) {
	return (
		<form.Field
			name={name}
			validators={{
				onSubmit: required ? ({ value }) => (value ? undefined : requiredMessage) : undefined,
			}}
		>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)} required={required}>
						{label}
					</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<DatePicker
							name={name}
							value={field.state.value}
							onChange={field.handleChange}
							onBlur={field.handleBlur}
							disabled={disabled}
							required={required}
						/>
					</TFormControl>
					{description && <TFormDescription>{description}</TFormDescription>}
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}
