"use client";

import { useTranslate } from "@tolgee/react";
import {
	CapAtOneDayField,
	CompensationBasisField,
	CompensationCurrencyField,
	CompensationRateField,
	DayUnitRuleField,
	MinutesField,
} from "@/components/settings/contracts/contractor-compensation-fields";
import {
	COMPENSATION_FIELD_REFUSALS,
	compensationFieldError,
} from "@/components/settings/contracts/contractor-compensation-form-values";
import { Checkbox } from "@/components/ui/checkbox";
import type { ContractorCompensationRefusal } from "@/lib/contractor-compensation/terms";
import type { InviteMemberFormApi, InviteMemberFormValues } from "./invite-member-form";

/**
 * The External Contractor invitation's optional first rate (#1935): hourly or
 * daily, with its currency and, for a daily rate, how worked days are counted.
 * The same fields, parsing and wording as the compensation card's terms form;
 * the rate applies from the engagement's start once the contractor joined.
 */
export function InvitationCompensationFields({ form }: { form: InviteMemberFormApi }) {
	const { t } = useTranslate();
	/** A field's error, only while the invitation sets a contractor's rate. */
	const errorFor = (
		values: InviteMemberFormValues,
		reasons: readonly ContractorCompensationRefusal[],
	): string | undefined =>
		!values.kioskOnly &&
		values.engagementKind === "contractor" &&
		values.contractorCompensationEnabled
			? compensationFieldError(t, values.contractorCompensation, reasons)
			: undefined;

	return (
		<div className="space-y-4">
			<form.Field name="contractorCompensationEnabled">
				{(field) => (
					<div className="flex items-start gap-x-2">
						<Checkbox
							id="contractorCompensationEnabled"
							checked={field.state.value}
							onCheckedChange={(checked) => field.handleChange(checked === true)}
							aria-describedby="contractorCompensationDescription"
						/>
						<div className="space-y-1">
							<label
								htmlFor="contractorCompensationEnabled"
								className="text-sm font-medium leading-none"
							>
								{t("organization.invite.contractor.compensation.label", "Set the rate now")}
							</label>
							<p id="contractorCompensationDescription" className="text-xs text-muted-foreground">
								{t(
									"organization.invite.contractor.compensation.description",
									"Applies from the start of their engagement once they join. Only organization admins see it; you can also set it later.",
								)}
							</p>
						</div>
					</div>
				)}
			</form.Field>

			<form.Subscribe
				selector={(state) => ({
					enabled: state.values.contractorCompensationEnabled,
					basis: state.values.contractorCompensation.basis,
					rule: state.values.contractorCompensation.dayUnitRule,
				})}
			>
				{({ enabled, basis, rule }) =>
					enabled ? (
						<div className="space-y-4 rounded-md border bg-muted/30 p-3">
							<div className="grid gap-4 sm:grid-cols-2">
								<form.Field name="contractorCompensation.basis">
									{(field) => <CompensationBasisField field={field} />}
								</form.Field>
								<form.Field
									name="contractorCompensation.currency"
									validators={{
										onSubmit: ({ fieldApi }) =>
											errorFor(fieldApi.form.state.values, COMPENSATION_FIELD_REFUSALS.currency),
									}}
								>
									{(field) => <CompensationCurrencyField field={field} />}
								</form.Field>
							</div>
							<form.Field
								name="contractorCompensation.rateAmount"
								validators={{
									onSubmit: ({ fieldApi }) =>
										errorFor(fieldApi.form.state.values, COMPENSATION_FIELD_REFUSALS.rateAmount),
								}}
							>
								{(field) => <CompensationRateField field={field} basis={basis} />}
							</form.Field>
							{basis === "daily" && (
								<>
									<form.Field name="contractorCompensation.dayUnitRule">
										{(field) => <DayUnitRuleField field={field} rule={rule} />}
									</form.Field>
									{rule === "half_and_full_day" && (
										<form.Field
											name="contractorCompensation.halfDayThresholdMinutes"
											validators={{
												onSubmit: ({ fieldApi }) =>
													errorFor(
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
												name="contractorCompensation.standardDayMinutes"
												validators={{
													onSubmit: ({ fieldApi }) =>
														errorFor(
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
											<form.Field name="contractorCompensation.capAtOneDay">
												{(field) => <CapAtOneDayField field={field} />}
											</form.Field>
										</div>
									)}
								</>
							)}
						</div>
					) : null
				}
			</form.Subscribe>
		</div>
	);
}
