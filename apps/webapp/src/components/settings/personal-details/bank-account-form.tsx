"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { changeEmployeeBankAccount } from "@/app/[locale]/(app)/settings/employees/personal-details-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { PersonalDetailsRefusalDetails } from "@/lib/organization/personal-details/types";
import {
	parseAccountHolder,
	parseBic,
	parseIban,
	parseValidFrom,
} from "@/lib/organization/personal-details/validation";
import { fieldRefusalMessage, PERSONAL_DETAILS_REFUSALS } from "./personal-details-copy";

type BankAccountFormValues = {
	validFrom: string;
	accountHolder: string;
	iban: string;
	bic: string;
};

type FieldName = keyof BankAccountFormValues;

/**
 * Records an employee's bank account from a valid-from day (#2069). Each field
 * is checked as it is typed with the module's own rules; the server checks again.
 */
export function BankAccountForm({
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
	const [error, setError] = useState<string | null>(null);
	const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({});

	const form = useForm({
		defaultValues: {
			validFrom: today,
			accountHolder: "",
			iban: "",
			bic: "",
		} satisfies BankAccountFormValues as BankAccountFormValues,
		onSubmit: async ({ value }) => {
			setError(null);
			setServerErrors({});
			try {
				const result = await changeEmployeeBankAccount({
					employeeId,
					validFrom: value.validFrom,
					accountHolder: value.accountHolder,
					iban: value.iban,
					bic: value.bic,
				});
				if (result.success) {
					toast.success(
						t(
							"settings.personalDetails.bankAccount.saved",
							"Bank account saved. The employee has been notified.",
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
				setError(
					actionErrorMessage(t, result, PERSONAL_DETAILS_REFUSALS, [
						"settings.personalDetails.bankAccount.saveFailed",
						"Could not save the bank account. Try again.",
					]),
				);
			} catch {
				setError(
					t(
						"settings.personalDetails.bankAccount.saveFailed",
						"Could not save the bank account. Try again.",
					),
				);
			}
		},
	});

	const check = <Code extends Parameters<typeof fieldRefusalMessage>[1]>(
		parsed: { ok: true } | { ok: false; code: Code },
	) => (parsed.ok ? undefined : fieldRefusalMessage(t, parsed.code));

	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border p-4"
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field
					name="accountHolder"
					validators={{ onChange: ({ value }) => check(parseAccountHolder(value)) }}
				>
					{(field) => (
						<TFormItem className="sm:col-span-2">
							<TFormLabel hasError={fieldHasError(field) || !!serverErrors.accountHolder} required>
								{t("settings.personalDetails.bankAccount.accountHolder", "Account holder")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field) || !!serverErrors.accountHolder}>
								<Input
									name="accountHolder"
									autoComplete="off"
									maxLength={200}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field}>{serverErrors.accountHolder}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="iban" validators={{ onChange: ({ value }) => check(parseIban(value)) }}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field) || !!serverErrors.iban} required>
								{t("settings.personalDetails.bankAccount.iban", "IBAN")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field) || !!serverErrors.iban}>
								<Input
									name="iban"
									autoComplete="off"
									spellCheck={false}
									inputMode="text"
									className="font-mono"
									placeholder="DE89 3704 0044 0532 0130 00"
									maxLength={60}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.personalDetails.bankAccount.ibanHelp",
									"With or without spaces. SEPA countries only.",
								)}
							</TFormDescription>
							<TFormMessage field={field}>{serverErrors.iban}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="bic" validators={{ onChange: ({ value }) => check(parseBic(value)) }}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field) || !!serverErrors.bic}>
								{t("settings.personalDetails.bankAccount.bicOptional", "BIC (optional)")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field) || !!serverErrors.bic}>
								<Input
									name="bic"
									autoComplete="off"
									spellCheck={false}
									className="font-mono"
									maxLength={20}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field}>{serverErrors.bic}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="validFrom"
					validators={{ onChange: ({ value }) => check(parseValidFrom(value)) }}
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
							{t("settings.personalDetails.bankAccount.save", "Save bank account")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
