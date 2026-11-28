"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { endEmployeeBankAccount } from "@/app/[locale]/(app)/settings/employees/personal-details-actions";
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
import { parseValidFrom } from "@/lib/organization/personal-details/validation";
import { fieldRefusalMessage, PERSONAL_DETAILS_REFUSALS } from "./personal-details-copy";

/**
 * Ends an employee's bank account from a day (#2071), for example after it was
 * entered on the wrong employee: no bank account is on file from that day, and
 * the employee is told.
 */
export function EndBankAccountForm({
	employeeId,
	today,
	onEnded,
	onCancel,
}: {
	employeeId: string;
	/** Today in the organization's timezone, YYYY-MM-DD: the default end day. */
	today: string;
	onEnded: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const [error, setError] = useState<string | null>(null);
	const [serverError, setServerError] = useState<string | undefined>(undefined);
	const failed = () =>
		t(
			"settings.personalDetails.bankAccount.endFailed",
			"Could not end the bank account. Try again.",
		);

	const form = useForm({
		defaultValues: { validFrom: today },
		onSubmit: async ({ value }) => {
			setError(null);
			setServerError(undefined);
			try {
				const result = await endEmployeeBankAccount({ employeeId, validFrom: value.validFrom });
				if (result.success) {
					toast.success(
						t(
							"settings.personalDetails.bankAccount.ended",
							"Bank account ended. The employee has been notified.",
						),
					);
					onEnded();
					return;
				}
				const code = (result.details as PersonalDetailsRefusalDetails | undefined)?.fields
					?.validFrom;
				setServerError(code ? fieldRefusalMessage(t, code) : undefined);
				setError(
					actionErrorMessage(t, result, PERSONAL_DETAILS_REFUSALS, [
						"settings.personalDetails.bankAccount.endFailed",
						"Could not end the bank account. Try again.",
					]),
				);
			} catch {
				setError(failed());
			}
		},
	});

	return (
		<form
			noValidate
			aria-label={t("settings.personalDetails.bankAccount.endTitle", "End bank account")}
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border border-destructive/40 p-4"
		>
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
					<TFormItem className="sm:max-w-xs">
						<TFormLabel hasError={fieldHasError(field) || !!serverError} required>
							{t("settings.personalDetails.endFrom", "End from")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field) || !!serverError}>
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
								"settings.personalDetails.bankAccount.endHelp",
								"From this date no bank account is on file. Earlier history is kept; entries after this date are removed. The employee is notified.",
							)}
						</TFormDescription>
						<TFormMessage field={field}>{serverError}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
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
						<Button type="submit" variant="destructive" disabled={!canSubmit || isSubmitting}>
							{isSubmitting ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : null}
							{t("settings.personalDetails.bankAccount.end", "End bank account")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
