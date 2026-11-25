"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/ui/client-form";
import { DatePicker } from "@/components/ui/date-picker";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type {
	ContractorCompensationRecord,
	ContractorTermsView,
} from "@/lib/contractor-compensation/store";
import {
	CapAtOneDayField,
	CompensationBasisField,
	CompensationCurrencyField,
	CompensationRateField,
	DayUnitRuleField,
	MinutesField,
} from "./contractor-compensation-fields";
import {
	COMPENSATION_FIELD_REFUSALS,
	type CompensationFormValues,
	compensationFieldError,
	defaultCompensationValues,
} from "./contractor-compensation-form-values";

/**
 * Entering contractor compensation terms (#1998): the terms form of the
 * compensation card. The values, their parsing and wording live in
 * `contractor-compensation-form-values`, the fields in
 * `contractor-compensation-fields`; the External Contractor invitation reuses
 * both for its optional first terms.
 */

export interface TermsFormValues extends CompensationFormValues {
	effectiveFrom: string;
}

type TermsFormMode = "set" | "end";

/** The first day the new terms, or their end, apply. */
function EffectiveFromField({
	field,
	mode,
	min,
}: {
	field: {
		state: { value: string; meta: { errors: unknown[] } };
		handleChange: (value: string) => void;
		handleBlur: () => void;
	};
	mode: TermsFormMode;
	min: string | undefined;
}) {
	const { t } = useTranslate();
	return (
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
					min={min}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

/** Cancel and save, both disabled while the terms are being saved. */
function TermsFormActions({
	mode,
	isSubmitting,
	onCancel,
}: {
	mode: TermsFormMode;
	isSubmitting: boolean;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex justify-end gap-2">
			<Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
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
	);
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
	mode: TermsFormMode;
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
					<EffectiveFromField
						field={field}
						mode={mode}
						min={record.earliestTermsDate ?? undefined}
					/>
				)}
			</form.Field>

			{mode === "set" && (
				<>
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="basis">
							{(field) => <CompensationBasisField field={field} />}
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
							{(field) => <CompensationCurrencyField field={field} />}
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
								{(field) => <CompensationRateField field={field} basis={basis} />}
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
										{(field) => <DayUnitRuleField field={field} rule={rule} />}
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
												{(field) => <CapAtOneDayField field={field} />}
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
					<TermsFormActions
						mode={mode}
						isSubmitting={isSubmitting}
						onCancel={() => {
							form.reset();
							onCancel();
						}}
					/>
				)}
			</form.Subscribe>
		</ClientForm>
	);
}
