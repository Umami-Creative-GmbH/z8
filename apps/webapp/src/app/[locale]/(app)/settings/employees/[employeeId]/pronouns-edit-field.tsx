"use client";

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
import type { Translate } from "./employee-section-shared";
import type { EmployeeDetailFormApi } from "./page-utils";

const PRONOUN_PRESETS = ["she/her", "he/him", "they/them"] as const;
const CUSTOM_PRONOUN_VALUE = "__custom__";
const PRONOUNS_MAX_LENGTH_MESSAGE = "Pronouns must be 50 characters or less";

export function PronounsEditField({
	form,
	disabled,
	t,
}: {
	form: EmployeeDetailFormApi;
	disabled: boolean;
	t: Translate;
}) {
	return (
		<form.Field
			name="pronouns"
			validators={{
				onBlur: ({ value }) => (value.trim().length > 50 ? PRONOUNS_MAX_LENGTH_MESSAGE : undefined),
				onChange: ({ value }) =>
					value.trim().length > 50 ? PRONOUNS_MAX_LENGTH_MESSAGE : undefined,
				onSubmit: ({ value }) =>
					value.trim().length > 50 ? PRONOUNS_MAX_LENGTH_MESSAGE : undefined,
			}}
		>
			{(field) => {
				const value = field.state.value;
				const isPreset = PRONOUN_PRESETS.includes(value as (typeof PRONOUN_PRESETS)[number]);
				const selectValue = isPreset ? value : "";
				const hasError = fieldHasError(field);
				const label = t("settings.employees.detailView.pronouns", "Pronouns");
				const customLabel = t("settings.employees.detailView.pronounsCustom", "Custom pronouns");

				return (
					<TFormItem>
						<TFormLabel hasError={hasError}>{label}</TFormLabel>
						<Select
							value={selectValue}
							disabled={disabled}
							onValueChange={(nextValue) => {
								field.handleChange(nextValue === CUSTOM_PRONOUN_VALUE ? "" : nextValue);
							}}
						>
							<TFormControl hasError={hasError}>
								<SelectTrigger aria-label={`${label} presets`}>
									<SelectValue
										placeholder={t(
											"settings.employees.detailView.pronounsPlaceholder",
											"Select pronouns",
										)}
									/>
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value="she/her">she/her</SelectItem>
								<SelectItem value="he/him">he/him</SelectItem>
								<SelectItem value="they/them">they/them</SelectItem>
								<SelectItem value={CUSTOM_PRONOUN_VALUE}>{customLabel}</SelectItem>
							</SelectContent>
						</Select>
						{!isPreset ? (
							<div className="space-y-2">
								<label htmlFor="employee-pronouns-custom" className="text-xs text-muted-foreground">
									{customLabel}
								</label>
								<Input
									id="employee-pronouns-custom"
									name="pronouns"
									autoComplete="off"
									value={value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(
										"settings.employees.detailView.pronounsCustomPlaceholder",
										"e.g., xe/xem…",
									)}
									disabled={disabled}
								/>
							</div>
						) : null}
						<TFormMessage field={field} />
					</TFormItem>
				);
			}}
		</form.Field>
	);
}
