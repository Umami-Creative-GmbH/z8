"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
import type {
	ContractorCompensationRecord,
	ContractorTermsView,
} from "@/lib/contractor-compensation/store";
import {
	type CompensationBasis,
	type ContractorCompensationInput,
	type ContractorCompensationRefusal,
	type ContractorCompensationView,
	DEFAULT_CONTRACTOR_CURRENCY,
	DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
	DEFAULT_STANDARD_DAY_MINUTES,
	type DayUnitRuleKind,
	parseContractorCompensation,
} from "@/lib/contractor-compensation/terms";
import type { Translate } from "@/lib/organization-action/action-error-message";
import { CONTRACTOR_COMPENSATION_REFUSALS } from "./contractor-compensation-refusals";

/**
 * Entering contractor compensation terms (#1998): the terms form of the
 * compensation card, and the pieces the External Contractor invitation reuses
 * for its optional first terms (the values, their parsing and wording, the
 * day-unit rule options and the minutes field).
 */

/** Compensation as a form holds it: minutes as entered text. */
export interface CompensationFormValues {
	basis: CompensationBasis;
	rateAmount: string;
	currency: string;
	dayUnitRule: DayUnitRuleKind;
	halfDayThresholdMinutes: string;
	standardDayMinutes: string;
	capAtOneDay: boolean;
}

/** New compensation values, prefilled from `current` terms when there are any. */
export function defaultCompensationValues(
	current?: ContractorCompensationView | null,
): CompensationFormValues {
	return {
		basis: current?.compensationBasis ?? "daily",
		rateAmount: "",
		currency: current?.currency ?? DEFAULT_CONTRACTOR_CURRENCY,
		dayUnitRule: current?.dayUnitRule ?? "any_work_full_day",
		halfDayThresholdMinutes: String(
			current?.halfDayThresholdMinutes ?? DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
		),
		standardDayMinutes: String(current?.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES),
		capAtOneDay: current?.capAtOneDay ?? true,
	};
}

/** What the server receives: only the settings the chosen basis and rule use. */
export function compensationInputOf(value: CompensationFormValues): ContractorCompensationInput {
	const daily = value.basis === "daily";
	return {
		basis: value.basis,
		rateAmount: value.rateAmount,
		currency: value.currency,
		dayUnitRule: daily ? value.dayUnitRule : null,
		halfDayThresholdMinutes:
			daily && value.dayUnitRule === "half_and_full_day"
				? Number(value.halfDayThresholdMinutes)
				: null,
		standardDayMinutes:
			daily && value.dayUnitRule === "prorated_by_standard_day"
				? Number(value.standardDayMinutes)
				: null,
		capAtOneDay:
			daily && value.dayUnitRule === "prorated_by_standard_day" ? value.capAtOneDay : null,
	};
}

/**
 * The refusal of the whole entry, worded for a field when it is one of
 * `reasons` (the refusals that field causes); the server parses the same way.
 */
export function compensationFieldError(
	t: Translate,
	value: CompensationFormValues,
	reasons: readonly ContractorCompensationRefusal[],
): string | undefined {
	const parsed = parseContractorCompensation(compensationInputOf(value));
	if (parsed.ok || !reasons.includes(parsed.reason)) return undefined;
	const [key, fallback] = CONTRACTOR_COMPENSATION_REFUSALS[parsed.reason];
	return t(key, fallback);
}

/** Which field each refusal of the entry belongs to. */
export const COMPENSATION_FIELD_REFUSALS = {
	currency: ["invalid_currency"],
	rateAmount: ["invalid_rate", "rate_not_positive", "rate_too_large", "rate_too_precise"],
	halfDayThresholdMinutes: ["invalid_half_day_threshold"],
	standardDayMinutes: ["invalid_standard_day"],
} as const satisfies Record<string, readonly ContractorCompensationRefusal[]>;

export const DAY_UNIT_RULE_OPTIONS: {
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

export function MinutesField({
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

export interface TermsFormValues extends CompensationFormValues {
	effectiveFrom: string;
}

/** Sets terms from a date, or ends the active engagement's terms from a date. */
export function ContractorTermsForm({
	mode,
	record,
	inEffect,
	endable,
	onCancel,
	onSubmit,
}: {
	mode: "set" | "end";
	record: ContractorCompensationRecord;
	inEffect: ContractorTermsView | null;
	/** The active engagement's terms; ending needs one that applies on the chosen day. */
	endable: readonly ContractorTermsView[];
	onCancel: () => void;
	onSubmit: (value: TermsFormValues) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: {
			effectiveFrom: record.today,
			...defaultCompensationValues(inEffect?.compensation),
		} satisfies TermsFormValues as TermsFormValues,
		onSubmit: async ({ value }) => {
			if (await onSubmit(value)) form.reset();
		},
	});

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
						if (record.earliestTermsDate && value < record.earliestTermsDate) {
							return t(
								"settings.contracts.contractors.errors.beforeEngagement",
								"Terms cannot start before the engagement started.",
							);
						}
						// Plain ISO days compare as strings; `effectiveTo` is exclusive.
						if (
							mode === "end" &&
							!endable.some(
								(terms) =>
									terms.effectiveFrom <= value &&
									(terms.effectiveTo === null || value < terms.effectiveTo),
							)
						) {
							return t(
								"settings.contracts.contractors.errors.nothingToEnd",
								"No rate applies on this date, so there is nothing to end.",
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
								min={record.earliestTermsDate ?? undefined}
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
									compensationFieldError(
										t,
										fieldApi.form.state.values,
										COMPENSATION_FIELD_REFUSALS.currency,
									),
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
										compensationFieldError(
											t,
											fieldApi.form.state.values,
											COMPENSATION_FIELD_REFUSALS.rateAmount,
										),
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
													compensationFieldError(
														t,
														fieldApi.form.state.values,
														COMPENSATION_FIELD_REFUSALS.halfDayThresholdMinutes,
													),
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
														compensationFieldError(
															t,
															fieldApi.form.state.values,
															COMPENSATION_FIELD_REFUSALS.standardDayMinutes,
														),
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
