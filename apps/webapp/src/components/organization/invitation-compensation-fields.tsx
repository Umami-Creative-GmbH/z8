"use client";

import { useTranslate } from "@tolgee/react";
import {
	COMPENSATION_FIELD_REFUSALS,
	compensationFieldError,
	DAY_UNIT_RULE_OPTIONS,
	MinutesField,
} from "@/components/settings/contracts/contractor-terms-form";
import { Checkbox } from "@/components/ui/checkbox";
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
	CompensationBasis,
	ContractorCompensationRefusal,
	DayUnitRuleKind,
} from "@/lib/contractor-compensation/terms";
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
									{(field) => (
										<TFormItem>
											<TFormLabel>
												{t("settings.contracts.contractors.basis", "Paid by")}
											</TFormLabel>
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
									name="contractorCompensation.currency"
									validators={{
										onSubmit: ({ fieldApi }) =>
											errorFor(fieldApi.form.state.values, COMPENSATION_FIELD_REFUSALS.currency),
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
							<form.Field
								name="contractorCompensation.rateAmount"
								validators={{
									onSubmit: ({ fieldApi }) =>
										errorFor(fieldApi.form.state.values, COMPENSATION_FIELD_REFUSALS.rateAmount),
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
							{basis === "daily" && (
								<>
									<form.Field name="contractorCompensation.dayUnitRule">
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
								</>
							)}
						</div>
					) : null
				}
			</form.Subscribe>
		</div>
	);
}
