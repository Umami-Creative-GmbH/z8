"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { changeEmployeeHealthInsurance } from "@/app/[locale]/(app)/settings/employees/personal-details-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import {
	type HealthInsuranceKind,
	INSURER_NAME_MAX_LENGTH,
	parseHealthInsurance,
	pickableStatutoryInsurers,
} from "@/lib/organization/personal-details/health-insurance";
import type { PersonalDetailsRefusalDetails } from "@/lib/organization/personal-details/types";
import { parseValidFrom } from "@/lib/organization/personal-details/validation";
import {
	fieldRefusalMessage,
	healthInsuranceKindLabel,
	PERSONAL_DETAILS_REFUSALS,
} from "./personal-details-copy";

type HealthInsuranceFormValues = {
	validFrom: string;
	kind: HealthInsuranceKind;
	/** A statutory insurer missing from the list: its name is typed. */
	typed: boolean;
	betriebsnummer: string;
	insurerName: string;
};

type FieldName = "validFrom" | "kind" | "betriebsnummer" | "insurerName";

const INSURER_OPTIONS = pickableStatutoryInsurers().map((insurer) => ({
	code: insurer.betriebsnummer,
	name: `${insurer.name} · ${insurer.betriebsnummer}`,
	keywords: [insurer.betriebsnummer],
}));

/**
 * Records an employee's health insurance from a valid-from day (#2070): a
 * statutory insurer picked from the bundled list (name and Betriebsnummer), a
 * statutory one typed by name when missing from it, or a private one by name.
 * Checked as it is entered with the module's own rules; the server checks again.
 */
export function HealthInsuranceForm({
	employeeId,
	today,
	onSaved,
	onCancel,
}: {
	employeeId: string;
	/** Today in the organization's timezone, YYYY-MM-DD: the default valid-from. */
	today: string;
	onSaved: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const [error, setError] = useState<string | null>(null);
	const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({});
	const failed = () =>
		t(
			"settings.personalDetails.healthInsurance.saveFailed",
			"Could not save the health insurance. Try again.",
		);

	const form = useForm({
		defaultValues: {
			validFrom: today,
			kind: "statutory",
			typed: false,
			betriebsnummer: "",
			insurerName: "",
		} satisfies HealthInsuranceFormValues as HealthInsuranceFormValues,
		onSubmit: async ({ value }) => {
			setError(null);
			setServerErrors({});
			const picked = value.kind === "statutory" && !value.typed;
			try {
				const result = await changeEmployeeHealthInsurance({
					employeeId,
					validFrom: value.validFrom,
					kind: value.kind,
					betriebsnummer: picked ? value.betriebsnummer : null,
					insurerName: picked ? null : value.insurerName,
				});
				if (result.success) {
					toast.success(
						t(
							"settings.personalDetails.healthInsurance.saved",
							"Health insurance saved. The employee has been notified.",
						),
					);
					onSaved();
					return;
				}
				const fields = (result.details as PersonalDetailsRefusalDetails | undefined)?.fields;
				if (fields) {
					setServerErrors(
						Object.fromEntries(
							Object.entries(fields).map(([name, code]) => [name, fieldRefusalMessage(t, code)]),
						),
					);
				}
				setError(actionErrorMessage(t, result, PERSONAL_DETAILS_REFUSALS, failed));
			} catch {
				setError(failed());
			}
		},
	});

	const pickRequired = t(
		"settings.personalDetails.fields.insurerPickRequired",
		"Choose the insurer from the list.",
	);

	return (
		<form
			noValidate
			aria-label={t(
				"settings.personalDetails.healthInsurance.changeTitle",
				"Change health insurance",
			)}
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border p-4"
		>
			<form.Field name="kind">
				{(field) => (
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">
							{t("settings.personalDetails.healthInsurance.kind", "Insurance")}
						</legend>
						<RadioGroup
							value={field.state.value}
							onValueChange={(next) => {
								if (next === "statutory" || next === "private") field.handleChange(next);
							}}
							className="flex flex-wrap gap-6"
						>
							{(["statutory", "private"] as const).map((kind) => (
								<div key={kind} className="flex items-center gap-2">
									<RadioGroupItem value={kind} id={`${id}-${kind}`} />
									<Label htmlFor={`${id}-${kind}`}>{healthInsuranceKindLabel(t, kind)}</Label>
								</div>
							))}
						</RadioGroup>
					</fieldset>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => [state.values.kind, state.values.typed] as const}>
				{([kind, typed]) => (
					<div className="grid gap-4 sm:grid-cols-2">
						{kind === "statutory" ? (
							<form.Field name="typed">
								{(field) => (
									<div className="flex items-center gap-2 sm:col-span-2">
										<Checkbox
											id={`${id}-typed`}
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<Label htmlFor={`${id}-typed`}>
											{t(
												"settings.personalDetails.healthInsurance.notOnList",
												"The insurer is not on the list",
											)}
										</Label>
									</div>
								)}
							</form.Field>
						) : null}
						{kind === "statutory" && !typed ? (
							<form.Field
								name="betriebsnummer"
								validators={{
									onSubmit: ({ value }) => (value === "" ? pickRequired : undefined),
								}}
							>
								{(field) => {
									const hasError = fieldHasError(field) || !!serverErrors.betriebsnummer;
									return (
										<TFormItem className="sm:col-span-2">
											<TFormLabel hasError={hasError} required htmlFor={`${id}-insurer`}>
												{t("settings.personalDetails.healthInsurance.insurer", "Insurer")}
											</TFormLabel>
											<SearchableSelect
												id={`${id}-insurer`}
												options={INSURER_OPTIONS}
												value={field.state.value}
												onValueChange={(next) => field.handleChange(next)}
												onOpenChange={(open) => {
													if (!open) field.handleBlur();
												}}
												placeholder={t(
													"settings.personalDetails.healthInsurance.pickInsurer",
													"Choose a statutory insurer",
												)}
												searchPlaceholder={t(
													"settings.personalDetails.healthInsurance.searchInsurer",
													"Search by name or Betriebsnummer",
												)}
												emptyText={t(
													"settings.personalDetails.healthInsurance.noInsurerFound",
													"No insurer found. If it is missing from the list, type its name instead.",
												)}
												aria-invalid={hasError}
												aria-required
											/>
											<TFormDescription>
												{t(
													"settings.personalDetails.healthInsurance.insurerHelp",
													"The name and Betriebsnummer are saved as they are on the list today.",
												)}
											</TFormDescription>
											<TFormMessage field={field}>{serverErrors.betriebsnummer}</TFormMessage>
										</TFormItem>
									);
								}}
							</form.Field>
						) : (
							<form.Field
								name="insurerName"
								validators={{
									onChange: ({ value, fieldApi }) => {
										const parsed = parseHealthInsurance({
											kind: fieldApi.form.getFieldValue("kind"),
											insurerName: value,
										});
										return parsed.ok || !parsed.errors.insurerName
											? undefined
											: fieldRefusalMessage(t, parsed.errors.insurerName);
									},
								}}
							>
								{(field) => (
									<TFormItem className="sm:col-span-2">
										<TFormLabel
											hasError={fieldHasError(field) || !!serverErrors.insurerName}
											required
										>
											{t("settings.personalDetails.healthInsurance.insurerName", "Insurer name")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field) || !!serverErrors.insurerName}>
											<Input
												name="insurerName"
												autoComplete="off"
												maxLength={INSURER_NAME_MAX_LENGTH + 20}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field}>{serverErrors.insurerName}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
						)}
						<form.Field
							name="validFrom"
							validators={{
								onChange: ({ value }) => {
									const parsed = parseValidFrom(value);
									return parsed.ok ? undefined : fieldRefusalMessage(t, parsed.code);
								},
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field) || !!serverErrors.validFrom} required>
										{t("settings.personalDetails.validFrom", "Valid from")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field) || !!serverErrors.validFrom}>
										<Input
											name="validFrom"
											type="date"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.personalDetails.validFromHelp",
											"A past date corrects the history; the same date replaces that entry.",
										)}
									</TFormDescription>
									<TFormMessage field={field}>{serverErrors.validFrom}</TFormMessage>
								</TFormItem>
							)}
						</form.Field>
					</div>
				)}
			</form.Subscribe>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
				{([canSubmit, isSubmitting]) => (
					<div className="flex flex-wrap justify-end gap-2">
						<Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={!canSubmit || isSubmitting}>
							{isSubmitting ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : null}
							{t("settings.personalDetails.healthInsurance.save", "Save health insurance")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
