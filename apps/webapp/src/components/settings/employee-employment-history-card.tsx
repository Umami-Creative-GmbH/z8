"use client";

import { IconCalendar, IconCheck, IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";

type ContractType = UpsertEmploymentHistory["contractType"];
type ReviewState = UpsertEmploymentHistory["reviewState"];
type WorkModel = UpsertEmploymentHistory["workModel"];

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
};

type FormValues = {
	validFrom: string;
	reviewState: ReviewState;
	weeklyHours: string;
	workModel: WorkModel;
	contractType: ContractType;
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

function formatDate(value: Date | string | null | undefined) {
	const date = toDateTime(value);
	return date?.isValid ? date.toLocaleString(DateTime.DATE_MED) : "Present";
}

function formatCurrency(amount: string | null, currency: string) {
	if (!amount) return null;
	return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
}

function formatWeeklyHours(minutes: number) {
	const hours = minutes / 60;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h / week`;
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
}: EmployeeEmploymentHistoryCardProps) {
	const [isAdding, setIsAdding] = useState(false);
	const now = DateTime.utc();
	const sortedHistory = history.toSorted((a, b) => {
		const aDate = toDateTime(a.validFrom)?.toMillis() ?? 0;
		const bDate = toDateTime(b.validFrom)?.toMillis() ?? 0;
		return bDate - aDate;
	});
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
				workPolicyId: null,
				hourlyRate: value.contractType === "hourly" ? value.hourlyRate : null,
				currency: "EUR",
				changeReason: value.changeReason.trim() || null,
				reviewState: value.reviewState,
			}).catch(() => null);

			if (!result) {
				toast.error("An unexpected error occurred");
				return;
			}

			if (result.success) {
				toast.success("Employment history change added");
				form.reset();
				setIsAdding(false);
				return;
			}

			toast.error(result.error || "Failed to add employment history change");
		},
	});

	const handleConfirm = async (historyId: string) => {
		const result = await onConfirm(historyId).catch(() => null);
		if (result?.success) {
			toast.success("Employment history change confirmed");
			return;
		}
		toast.error(result?.error || "Failed to confirm employment history change");
	};

	const handleCancel = async (historyId: string) => {
		const result = await onCancel(historyId).catch(() => null);
		if (result?.success) {
			toast.success("Employment history change canceled");
			return;
		}
		toast.error(result?.error || "Failed to cancel employment history change");
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div>
					<CardTitle>Contract & Work Model</CardTitle>
					<CardDescription>Confirmed context and scheduled employment changes</CardDescription>
				</div>
				{canManage && (
					<Button
						size="sm"
						variant={isAdding ? "outline" : "default"}
						onClick={() => setIsAdding(!isAdding)}
					>
						<IconPlus className="mr-2 size-4" aria-hidden="true" />
						Add Change
					</Button>
				)}
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="grid gap-3 md:grid-cols-2">
					<ContextPanel
						label="Current confirmed"
						entry={current}
						empty="No confirmed contract context"
					/>
					<ContextPanel
						label="Next scheduled confirmed"
						entry={nextConfirmed}
						empty="No confirmed change scheduled"
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
								label="Effective Date"
								disabled={isCreating}
								required
							/>
							<TextField
								form={form}
								name="weeklyHours"
								label="Weekly Hours"
								type="number"
								disabled={isCreating}
							/>
							<form.Field name="reviewState">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>Review State</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as ReviewState)}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue placeholder="Select review state" />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="draft">draft</SelectItem>
												<SelectItem value="pending">pending</SelectItem>
												<SelectItem value="confirmed">confirmed</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="workModel">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>Work Model</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as WorkModel)}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue placeholder="Select work model" />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="onsite">onsite</SelectItem>
												<SelectItem value="hybrid">hybrid</SelectItem>
												<SelectItem value="remote">remote</SelectItem>
												<SelectItem value="flexible">flexible</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="contractType">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>Contract Type</TFormLabel>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as ContractType)}
											disabled={isCreating}
										>
											<TFormControl hasError={fieldHasError(field)}>
												<SelectTrigger>
													<SelectValue placeholder="Select contract type" />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="fixed">fixed</SelectItem>
												<SelectItem value="hourly">hourly</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<TextField
								form={form}
								name="hourlyRate"
								label="Hourly Rate"
								type="number"
								disabled={isCreating}
							/>
							<DateField
								form={form}
								name="probationStartsOn"
								label="Probation Start"
								disabled={isCreating}
							/>
							<DateField
								form={form}
								name="probationEndsOn"
								label="Probation End"
								disabled={isCreating}
							/>
						</div>
						<form.Field name="changeReason">
							{(field) => (
								<TFormItem className="mt-4">
									<TFormLabel hasError={fieldHasError(field)}>Reason / Note</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="changeReason"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={isCreating}
											autoComplete="off"
											placeholder="Annual review, role change, or work-model update…"
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
								Cancel
							</Button>
							<Button type="submit" disabled={isCreating}>
								{isCreating && (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								)}
								Save Change
							</Button>
						</div>
					</form>
				)}

				<div className="space-y-3">
					<div className="text-sm font-medium">Timeline</div>
					{sortedHistory.length === 0 ? (
						<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
							No contract or work-model history yet.
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
}: {
	entry?: EmploymentHistoryEntry;
	label: string;
	empty: string;
}) {
	return (
		<div className="rounded-lg border p-4">
			<div className="mb-2 text-sm text-muted-foreground">{label}</div>
			{entry ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="default">{formatWeeklyHours(entry.weeklyContractMinutes)}</Badge>
						<Badge variant="outline">{entry.workModel}</Badge>
						<Badge variant="secondary">{entry.contractType}</Badge>
					</div>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<IconCalendar className="size-3" aria-hidden="true" />
						<span>Effective {formatDate(entry.validFrom)}</span>
					</div>
					{entry.contractType === "hourly" && entry.hourlyRate && (
						<div className="text-sm">{formatCurrency(entry.hourlyRate, entry.currency)} / hour</div>
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
}: {
	entry: EmploymentHistoryEntry;
	canManage: boolean;
	isMutating: boolean;
	now: DateTime;
	onConfirm: (historyId: string) => void;
	onCancel: (historyId: string) => void;
}) {
	const current = isCurrentConfirmed(entry, now);
	const hourlyRate = formatCurrency(entry.hourlyRate, entry.currency);

	return (
		<div className="rounded-lg border p-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<span className={cn("font-medium", current && "text-primary")}>
							{formatWeeklyHours(entry.weeklyContractMinutes)}
						</span>
						<Badge variant={entry.reviewState === "confirmed" ? "default" : "secondary"}>
							{entry.reviewState}
						</Badge>
						{current && <Badge variant="outline">Current</Badge>}
					</div>
					<div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
						<span>{entry.workModel}</span>
						<span aria-hidden="true">·</span>
						<span>{entry.contractType}</span>
						{hourlyRate && (
							<>
								<span aria-hidden="true">·</span>
								<span>{hourlyRate} / hour</span>
							</>
						)}
					</div>
					<div className="text-xs text-muted-foreground">
						{formatDate(entry.validFrom)} -{" "}
						{entry.validUntil ? formatDate(entry.validUntil) : "Present"}
					</div>
					{entry.probationStartsOn && entry.probationEndsOn && (
						<div className="text-xs text-muted-foreground">
							Probation {formatDate(entry.probationStartsOn)} - {formatDate(entry.probationEndsOn)}
						</div>
					)}
					{entry.changeReason && (
						<div className="text-sm text-muted-foreground">{entry.changeReason}</div>
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
								Confirm
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
								Cancel
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
	required,
}: {
	form: EmploymentHistoryFormApi;
	name: "validFrom" | "probationStartsOn" | "probationEndsOn";
	label: string;
	disabled?: boolean;
	required?: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)} required={required}>
						{label}
					</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<Input
							name={name}
							type="date"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							disabled={disabled}
							required={required}
							autoComplete="off"
						/>
					</TFormControl>
					{name === "validFrom" && (
						<TFormDescription>When this contract context takes effect</TFormDescription>
					)}
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}
