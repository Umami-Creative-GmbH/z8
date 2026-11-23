"use client";

import {
	IconBuilding,
	IconCalendar,
	IconCircleDot,
	IconLoader2,
	IconPlus,
	IconReceipt2,
	IconX,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
	endContractorTerms,
	getContractorCompensation,
	setContractorTerms,
	updateContractorDetails,
} from "@/app/[locale]/(app)/settings/contracts/contractor-compensation-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ClientForm } from "@/components/ui/client-form";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatBillableAmount, formatRateDate, lastDayBefore } from "@/lib/billable-time/format";
import type {
	ContractorCompensationRecord,
	ContractorTermsView,
} from "@/lib/contractor-compensation/store";
import {
	type CompensationBasis,
	type ContractorCompensationRefusal,
	type ContractorCompensationView,
	DEFAULT_CONTRACTOR_CURRENCY,
	DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
	DEFAULT_STANDARD_DAY_MINUTES,
	type DayUnitRuleKind,
	parseContractorCompensation,
} from "@/lib/contractor-compensation/terms";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
	type Translate,
} from "@/lib/organization-action/action-error-message";
import { cn } from "@/lib/utils";

export const contractorCompensationQueryKey = (employeeId: string) =>
	["contractor-compensation", employeeId] as const;

type TermsRefusal =
	| ContractorCompensationRefusal
	| "invalid_date"
	| "not_contractor"
	| "before_engagement";

/** How every refusal of the contractor compensation actions reads. */
export const CONTRACTOR_COMPENSATION_REFUSALS = {
	invalid_date: ["settings.contracts.contractors.errors.invalidDate", "Choose a valid date."],
	not_contractor: [
		"settings.contracts.contractors.errors.notContractor",
		"Contractor terms need an active External Contractor engagement.",
	],
	before_engagement: [
		"settings.contracts.contractors.errors.beforeEngagement",
		"Terms cannot start before the engagement started.",
	],
	invalid_basis: ["settings.contracts.contractors.errors.invalidBasis", "Choose hourly or daily."],
	invalid_currency: [
		"settings.contracts.contractors.errors.invalidCurrency",
		"Enter an ISO 4217 currency code, such as EUR.",
	],
	invalid_rate: ["settings.contracts.contractors.errors.invalidRate", "Enter a rate."],
	rate_not_positive: [
		"settings.contracts.contractors.errors.rateNotPositive",
		"Enter a rate above zero.",
	],
	rate_too_large: [
		"settings.contracts.contractors.errors.rateTooLarge",
		"Enter a rate below one million.",
	],
	rate_too_precise: [
		"settings.contracts.contractors.errors.rateTooPrecise",
		"The rate has more decimals than the currency allows.",
	],
	invalid_day_unit_rule: [
		"settings.contracts.contractors.errors.invalidDayUnitRule",
		"Choose how worked days are counted.",
	],
	invalid_half_day_threshold: [
		"settings.contracts.contractors.errors.invalidHalfDayThreshold",
		"Enter a half-day threshold from 1 to 1440 minutes.",
	],
	invalid_standard_day: [
		"settings.contracts.contractors.errors.invalidStandardDay",
		"Enter a standard day from 1 to 1440 minutes.",
	],
	NotFoundError: [
		"settings.contracts.contractors.errors.notFound",
		"This person was not found in your organization.",
	],
} satisfies RefusalMessages<TermsRefusal | "NotFoundError">;

// Display only: the decimal string and the plain day are formatted as they are.
const formatMoney = formatBillableAmount;
const formatDay = formatRateDate;

/** "€650.00 per day" and how worked days are counted. */
export function describeCompensation(
	t: Translate,
	locale: string,
	terms: ContractorCompensationView,
): { rate: string; rule: string | null } {
	const amount = formatMoney(locale, terms.rateAmount, terms.currency);
	if (terms.compensationBasis === "hourly") {
		return {
			rate: t("settings.contracts.contractors.perHour", "{amount} per hour", { amount }),
			rule: null,
		};
	}
	const rate = t("settings.contracts.contractors.perDay", "{amount} per day", { amount });
	switch (terms.dayUnitRule) {
		case "half_and_full_day":
			return {
				rate,
				rule: t(
					"settings.contracts.contractors.ruleSummary.halfAndFullDay",
					"Half day up to {minutes} min, full day above",
					{ minutes: terms.halfDayThresholdMinutes ?? DEFAULT_HALF_DAY_THRESHOLD_MINUTES },
				),
			};
		case "prorated_by_standard_day":
			return {
				rate,
				rule: terms.capAtOneDay
					? t(
							"settings.contracts.contractors.ruleSummary.proratedCapped",
							"Prorated by a {minutes}-minute day, at most one day",
							{ minutes: terms.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES },
						)
					: t(
							"settings.contracts.contractors.ruleSummary.proratedUncapped",
							"Prorated by a {minutes}-minute day, without a cap",
							{ minutes: terms.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES },
						),
			};
		default:
			return {
				rate,
				rule: t(
					"settings.contracts.contractors.ruleSummary.anyWorkFullDay",
					"Any day with work counts as a full day",
				),
			};
	}
}

export interface ContractorCompensationCardProps {
	employeeId: string;
	/** Render without the card frame, e.g. inside an action panel. */
	bare?: boolean;
	/** Called after terms or details were saved, e.g. to refresh an overview. */
	onChanged?: () => void;
}

/**
 * An External Contractor's compensation (#1998): effective-dated hourly or
 * daily terms and the contracting company, VAT ID and PO reference. Org admins
 * only; the actions refuse everyone else. Renders nothing for an employee
 * without contractor terms on record.
 */
export function ContractorCompensationCard({
	employeeId,
	bare,
	onChanged,
}: ContractorCompensationCardProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = contractorCompensationQueryKey(employeeId);
	const record = useQuery({
		queryKey,
		queryFn: async (): Promise<ContractorCompensationRecord> => {
			const result = await getContractorCompensation({ employeeId });
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS, () =>
						t(
							"settings.contracts.contractors.loadError",
							"Contractor compensation could not be loaded",
						),
					),
				);
			}
			return result.data;
		},
	});

	const data = record.data;
	if (data && data.activeEngagementKind !== "contractor" && data.history.length === 0) return null;

	const isContractor = data?.activeEngagementKind === "contractor";
	const refresh = (next: Partial<ContractorCompensationRecord>) => {
		queryClient.setQueryData<ContractorCompensationRecord>(queryKey, (previous) =>
			previous ? { ...previous, ...next } : previous,
		);
		onChanged?.();
	};

	const body = record.isPending ? (
		<div className="flex items-center justify-center p-4" role="status">
			<IconLoader2
				aria-hidden="true"
				className="size-6 text-muted-foreground motion-safe:animate-spin"
			/>
			<span className="sr-only">{t("common.loading", "Loading")}</span>
		</div>
	) : record.isError || !data ? (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="text-sm text-destructive" role="alert">
				{record.error?.message ??
					t(
						"settings.contracts.contractors.loadError",
						"Contractor compensation could not be loaded",
					)}
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={record.isFetching}
				onClick={() => void record.refetch()}
			>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	) : (
		<div className="space-y-6">
			<ContractorTermsSection
				employeeId={employeeId}
				record={data}
				canEdit={isContractor}
				onSaved={refresh}
			/>
			{isContractor && (
				<ContractorDetailsForm
					employeeId={employeeId}
					record={data}
					onSaved={(details) => refresh({ details })}
				/>
			)}
		</div>
	);

	const header = (
		<div className="min-w-0 space-y-1">
			<div className="flex flex-wrap items-center gap-2 font-semibold">
				<IconReceipt2 aria-hidden="true" className="size-5" />
				{t("settings.contracts.contractors.title", "Contractor compensation")}
			</div>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.contracts.contractors.description",
					"What this External Contractor is paid, by hour or by day, from which date. Only organization admins see these rates; they never change employee contracts or payroll.",
				)}
			</p>
		</div>
	);

	if (bare) {
		return (
			<div className="space-y-4">
				{header}
				{body}
			</div>
		);
	}
	return (
		<Card>
			<CardHeader>{header}</CardHeader>
			<CardContent>{body}</CardContent>
		</Card>
	);
}

type SavedTerms = Pick<ContractorCompensationRecord, "history" | "termsInEffectId">;
type ChangeResult = ServerActionResult<SavedTerms & { changed: boolean }>;

function ContractorTermsSection({
	employeeId,
	record,
	canEdit,
	onSaved,
}: {
	employeeId: string;
	record: ContractorCompensationRecord;
	canEdit: boolean;
	onSaved: (saved: SavedTerms) => void;
}) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const [mode, setMode] = useState<"set" | "end" | null>(null);
	// The server marks the terms pricing applies today (clipped to their engagement).
	const inEffect = record.history.find((terms) => terms.id === record.termsInEffectId) ?? null;

	const apply = async (change: Promise<ChangeResult>): Promise<boolean> => {
		const result = await change.catch(() => null);
		if (!result) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			return false;
		}
		if (!result.success) {
			toast.error(actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS));
			return false;
		}
		onSaved({ history: result.data.history, termsInEffectId: result.data.termsInEffectId });
		toast.success(
			result.data.changed
				? t("settings.contracts.contractors.saved", "Contractor terms saved")
				: t("settings.contracts.contractors.unchanged", "These terms already apply"),
		);
		setMode(null);
		return true;
	};

	return (
		<section className="space-y-4" aria-labelledby={`contractor-terms-${employeeId}`}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 id={`contractor-terms-${employeeId}`} className="text-sm font-medium">
					{t("settings.contracts.contractors.termsHeading", "Rates")}
				</h3>
				{canEdit && mode === null && (
					<div className="flex flex-wrap gap-2">
						<Button size="sm" onClick={() => setMode("set")}>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t("settings.contracts.contractors.setTerms", "Set rate")}
						</Button>
						{record.history.length > 0 && (
							<Button size="sm" variant="outline" onClick={() => setMode("end")}>
								<IconX aria-hidden="true" className="mr-2 size-4" />
								{t("settings.contracts.contractors.endTerms", "End rate")}
							</Button>
						)}
					</div>
				)}
			</div>
			{!canEdit && (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.contracts.contractors.readOnly",
						"This person has no active External Contractor engagement. Earlier contractor rates stay on record.",
					)}
				</p>
			)}
			{mode !== null && (
				<ContractorTermsForm
					mode={mode}
					record={record}
					inEffect={inEffect}
					onCancel={() => setMode(null)}
					onSubmit={(value) =>
						apply(
							mode === "end"
								? endContractorTerms({ employeeId, effectiveFrom: value.effectiveFrom })
								: setContractorTerms({
										employeeId,
										effectiveFrom: value.effectiveFrom,
										compensation: {
											basis: value.basis,
											rateAmount: value.rateAmount,
											currency: value.currency,
											dayUnitRule: value.basis === "daily" ? value.dayUnitRule : null,
											halfDayThresholdMinutes:
												value.basis === "daily" && value.dayUnitRule === "half_and_full_day"
													? Number(value.halfDayThresholdMinutes)
													: null,
											standardDayMinutes:
												value.basis === "daily" && value.dayUnitRule === "prorated_by_standard_day"
													? Number(value.standardDayMinutes)
													: null,
											capAtOneDay:
												value.basis === "daily" && value.dayUnitRule === "prorated_by_standard_day"
													? value.capAtOneDay
													: null,
										},
									}),
						)
					}
				/>
			)}
			{record.history.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.contracts.contractors.empty",
						"No rate yet. This contractor's work stays unpriced until a rate applies.",
					)}
				</p>
			) : (
				<div className="relative pl-6">
					<div aria-hidden="true" className="absolute top-0 bottom-0 left-[11px] w-px bg-border" />
					<ol className="space-y-4">
						{record.history.map((terms) => {
							const isInEffect = terms.id === inEffect?.id;
							const summary = describeCompensation(t, locale, terms.compensation);
							const from = formatDay(locale, terms.effectiveFrom);
							return (
								<li key={terms.id} className="relative flex items-start gap-4">
									<div
										aria-hidden="true"
										className={cn(
											"absolute left-[-13px] flex size-6 items-center justify-center rounded-full",
											isInEffect ? "bg-primary text-primary-foreground" : "bg-muted",
										)}
									>
										<IconCircleDot className="size-4" />
									</div>
									<div className="ml-4 min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={cn("font-medium tabular-nums", isInEffect && "text-primary")}
											>
												{summary.rate}
											</span>
											{isInEffect && (
												<Badge variant="default">
													{t("settings.contracts.contractors.inEffect", "In effect")}
												</Badge>
											)}
										</div>
										{summary.rule && (
											<p className="text-sm text-muted-foreground">{summary.rule}</p>
										)}
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											<IconCalendar aria-hidden="true" className="size-3" />
											<span className="tabular-nums">
												{terms.effectiveTo === null
													? t("settings.contracts.contractors.openPeriod", "From {from}", { from })
													: t("settings.contracts.contractors.closedPeriod", "{from} to {to}", {
															from,
															to: formatDay(locale, lastDayBefore(terms.effectiveTo)),
														})}
											</span>
										</div>
									</div>
								</li>
							);
						})}
					</ol>
				</div>
			)}
		</section>
	);
}

interface TermsFormValues {
	effectiveFrom: string;
	basis: CompensationBasis;
	rateAmount: string;
	currency: string;
	dayUnitRule: DayUnitRuleKind;
	halfDayThresholdMinutes: string;
	standardDayMinutes: string;
	capAtOneDay: boolean;
}

const DAY_UNIT_RULE_OPTIONS: {
	value: DayUnitRuleKind;
	labelKey: string;
	label: string;
	hintKey: string;
	hint: string;
}[] = [
	{
		value: "any_work_full_day",
		labelKey: "settings.contracts.contractors.rules.anyWorkFullDay",
		label: "Any work is a full day",
		hintKey: "settings.contracts.contractors.rules.anyWorkFullDayHint",
		hint: "A local day with any completed work counts as 1.0 day.",
	},
	{
		value: "half_and_full_day",
		labelKey: "settings.contracts.contractors.rules.halfAndFullDay",
		label: "Half and full days",
		hintKey: "settings.contracts.contractors.rules.halfAndFullDayHint",
		hint: "Up to and including the threshold counts as 0.5 day, more as 1.0 day.",
	},
	{
		value: "prorated_by_standard_day",
		labelKey: "settings.contracts.contractors.rules.proratedByStandardDay",
		label: "Prorated by a standard day",
		hintKey: "settings.contracts.contractors.rules.proratedByStandardDayHint",
		hint: "Worked minutes divided by the standard day, optionally at most 1.0 day.",
	},
];

function ContractorTermsForm({
	mode,
	record,
	inEffect,
	onCancel,
	onSubmit,
}: {
	mode: "set" | "end";
	record: ContractorCompensationRecord;
	inEffect: ContractorTermsView | null;
	onCancel: () => void;
	onSubmit: (value: TermsFormValues) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const current = inEffect?.compensation;
	const form = useForm({
		defaultValues: {
			effectiveFrom: record.today,
			basis: current?.compensationBasis ?? "daily",
			rateAmount: "",
			currency: current?.currency ?? DEFAULT_CONTRACTOR_CURRENCY,
			dayUnitRule: current?.dayUnitRule ?? "any_work_full_day",
			halfDayThresholdMinutes: String(
				current?.halfDayThresholdMinutes ?? DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
			),
			standardDayMinutes: String(current?.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES),
			capAtOneDay: current?.capAtOneDay ?? true,
		} satisfies TermsFormValues as TermsFormValues,
		onSubmit: async ({ value }) => {
			if (await onSubmit(value)) form.reset();
		},
	});

	/** The first refusal of the whole entry, worded for the field it belongs to. */
	const refusalFor = (value: TermsFormValues): ContractorCompensationRefusal | null => {
		const parsed = parseContractorCompensation({
			basis: value.basis,
			rateAmount: value.rateAmount,
			currency: value.currency,
			dayUnitRule: value.basis === "daily" ? value.dayUnitRule : null,
			halfDayThresholdMinutes: Number(value.halfDayThresholdMinutes),
			standardDayMinutes: Number(value.standardDayMinutes),
			capAtOneDay: value.capAtOneDay,
		});
		return parsed.ok ? null : parsed.reason;
	};
	const fieldError = (
		value: TermsFormValues,
		reasons: readonly ContractorCompensationRefusal[],
	): string | undefined => {
		const reason = refusalFor(value);
		if (reason === null || !reasons.includes(reason)) return undefined;
		const [key, fallback] = CONTRACTOR_COMPENSATION_REFUSALS[reason];
		return t(key, fallback);
	};

	return (
		<ClientForm
			stopPropagation
			onSubmit={() => {
				if (form.state.isSubmitting) return;
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border bg-muted/30 p-4"
		>
			<p className="text-sm text-muted-foreground">
				{mode === "set"
					? t(
							"settings.contracts.contractors.setHelp",
							"The new rate applies from this date until the next change. Earlier periods keep their rates.",
						)
					: t(
							"settings.contracts.contractors.endHelp",
							"From this date no rate applies until the next change; work stays unpriced meanwhile.",
						)}
			</p>
			<form.Field
				name="effectiveFrom"
				validators={{
					onSubmit: ({ value }) => {
						if (!value) {
							return t(
								"settings.contracts.contractors.dateRequired",
								"Choose the first day it applies",
							);
						}
						if (record.engagementStartDate && value < record.engagementStartDate) {
							return t(
								"settings.contracts.contractors.errors.beforeEngagement",
								"Terms cannot start before the engagement started.",
							);
						}
						return undefined;
					},
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{mode === "set"
								? t("settings.contracts.contractors.effectiveFrom", "Applies from")
								: t("settings.contracts.contractors.endsFrom", "No longer applies from")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<DatePicker
								value={field.state.value}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
								min={record.engagementStartDate ?? undefined}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			{mode === "set" && (
				<>
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="basis">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.contracts.contractors.basis", "Paid by")}</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) =>
											value && field.handleChange(value as CompensationBasis)
										}
									>
										<TFormControl>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value="daily">
												{t("settings.contracts.contractors.basisDaily", "Day")}
											</SelectItem>
											<SelectItem value="hourly">
												{t("settings.contracts.contractors.basisHourly", "Hour")}
											</SelectItem>
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="currency"
							validators={{
								onSubmit: ({ fieldApi }) =>
									fieldError(fieldApi.form.state.values, ["invalid_currency"]),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.contracts.contractors.currency", "Currency")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											autoComplete="off"
											maxLength={3}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
											onBlur={field.handleBlur}
											className="uppercase"
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Subscribe selector={(state) => state.values.basis}>
						{(basis) => (
							<form.Field
								name="rateAmount"
								validators={{
									onSubmit: ({ fieldApi }) =>
										fieldError(fieldApi.form.state.values, [
											"invalid_rate",
											"rate_not_positive",
											"rate_too_large",
											"rate_too_precise",
										]),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{basis === "daily"
												? t("settings.contracts.contractors.dailyRate", "Daily rate")
												: t("settings.contracts.contractors.hourlyRate", "Hourly rate")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												inputMode="decimal"
												autoComplete="off"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="tabular-nums"
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						)}
					</form.Subscribe>

					<form.Subscribe
						selector={(state) => ({ basis: state.values.basis, rule: state.values.dayUnitRule })}
					>
						{({ basis, rule }) =>
							basis === "daily" && (
								<div className="space-y-4">
									<form.Field name="dayUnitRule">
										{(field) => (
											<TFormItem>
												<TFormLabel>
													{t("settings.contracts.contractors.dayUnitRule", "How days are counted")}
												</TFormLabel>
												<Select
													value={field.state.value}
													onValueChange={(value) =>
														value && field.handleChange(value as DayUnitRuleKind)
													}
												>
													<TFormControl>
														<SelectTrigger>
															<SelectValue />
														</SelectTrigger>
													</TFormControl>
													<SelectContent>
														{DAY_UNIT_RULE_OPTIONS.map((option) => (
															<SelectItem key={option.value} value={option.value}>
																{t(option.labelKey, option.label)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<TFormDescription>
													{DAY_UNIT_RULE_OPTIONS.filter((option) => option.value === rule).map(
														(option) => t(option.hintKey, option.hint),
													)}
												</TFormDescription>
											</TFormItem>
										)}
									</form.Field>
									{rule === "half_and_full_day" && (
										<form.Field
											name="halfDayThresholdMinutes"
											validators={{
												onSubmit: ({ fieldApi }) =>
													fieldError(fieldApi.form.state.values, ["invalid_half_day_threshold"]),
											}}
										>
											{(field) => (
												<MinutesField
													field={field}
													label={t(
														"settings.contracts.contractors.halfDayThreshold",
														"Half-day threshold (minutes)",
													)}
												/>
											)}
										</form.Field>
									)}
									{rule === "prorated_by_standard_day" && (
										<div className="grid gap-4 sm:grid-cols-2">
											<form.Field
												name="standardDayMinutes"
												validators={{
													onSubmit: ({ fieldApi }) =>
														fieldError(fieldApi.form.state.values, ["invalid_standard_day"]),
												}}
											>
												{(field) => (
													<MinutesField
														field={field}
														label={t(
															"settings.contracts.contractors.standardDay",
															"Standard day (minutes)",
														)}
													/>
												)}
											</form.Field>
											<form.Field name="capAtOneDay">
												{(field) => (
													<TFormItem className="flex flex-row items-center gap-3 sm:pt-7">
														<TFormControl>
															<Switch
																checked={field.state.value}
																onCheckedChange={(checked) => field.handleChange(checked)}
															/>
														</TFormControl>
														<TFormLabel>
															{t(
																"settings.contracts.contractors.capAtOneDay",
																"At most one day per day",
															)}
														</TFormLabel>
													</TFormItem>
												)}
											</form.Field>
										</div>
									)}
								</div>
							)
						}
					</form.Subscribe>
				</>
			)}

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting}
							onClick={() => {
								form.reset();
								onCancel();
							}}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 motion-safe:animate-spin" />
							)}
							{mode === "set"
								? t("settings.contracts.contractors.saveTerms", "Save rate")
								: t("settings.contracts.contractors.saveEnd", "End rate")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</ClientForm>
	);
}

function MinutesField({
	field,
	label,
}: {
	field: {
		state: { value: string; meta: { errors: unknown[] } };
		handleChange: (value: string) => void;
		handleBlur: () => void;
	};
	label: ReactNode;
}) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				{/* No native min/max: the browser would block the submit before the form words the range. */}
				<Input
					inputMode="numeric"
					autoComplete="off"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					className="tabular-nums"
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

function ContractorDetailsForm({
	employeeId,
	record,
	onSaved,
}: {
	employeeId: string;
	record: ContractorCompensationRecord;
	onSaved: (details: NonNullable<ContractorCompensationRecord["details"]>) => void;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: {
			companyName: record.details?.companyName ?? "",
			vatId: record.details?.vatId ?? "",
			referenceCode: record.details?.referenceCode ?? "",
		},
		onSubmit: async ({ value }) => {
			const result = await updateContractorDetails({ employeeId, ...value }).catch(() => null);
			if (!result) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			if (!result.success) {
				toast.error(actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS));
				return;
			}
			onSaved(result.data);
			form.reset({
				companyName: result.data.companyName ?? "",
				vatId: result.data.vatId ?? "",
				referenceCode: result.data.referenceCode ?? "",
			});
			toast.success(t("settings.contracts.contractors.detailsSaved", "Contracting details saved"));
		},
	});

	const fields = [
		{
			name: "companyName",
			label: t("settings.contracts.contractors.companyName", "Company name"),
			maxLength: 200,
		},
		{ name: "vatId", label: t("settings.contracts.contractors.vatId", "VAT ID"), maxLength: 50 },
		{
			name: "referenceCode",
			label: t("settings.contracts.contractors.referenceCode", "PO or cost-center reference"),
			maxLength: 100,
		},
	] as const;

	return (
		<section
			className="space-y-3 border-t pt-4"
			aria-labelledby={`contractor-details-${employeeId}`}
		>
			<div className="space-y-1">
				<h3
					id={`contractor-details-${employeeId}`}
					className="flex items-center gap-2 text-sm font-medium"
				>
					<IconBuilding aria-hidden="true" className="size-4" />
					{t("settings.contracts.contractors.detailsHeading", "Contracting details")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.contracts.contractors.detailsDescription",
						"Optional. Shown on contractor statements so finance can match incoming invoices.",
					)}
				</p>
			</div>
			<ClientForm
				stopPropagation
				onSubmit={() => {
					if (form.state.isSubmitting) return;
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div className="grid gap-4 sm:grid-cols-3">
					{fields.map((entry) => (
						<form.Field key={entry.name} name={entry.name}>
							{(field) => (
								<TFormItem>
									<TFormLabel>{entry.label}</TFormLabel>
									<TFormControl>
										<Input
											autoComplete="off"
											maxLength={entry.maxLength}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
					))}
				</div>
				<form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
					{([isSubmitting, isDirty]) => (
						<div className="flex justify-end">
							<Button type="submit" variant="outline" disabled={isSubmitting || !isDirty}>
								{isSubmitting && (
									<IconLoader2
										aria-hidden="true"
										className="mr-2 size-4 motion-safe:animate-spin"
									/>
								)}
								{t("settings.contracts.contractors.saveDetails", "Save details")}
							</Button>
						</div>
					)}
				</form.Subscribe>
			</ClientForm>
		</section>
	);
}
