"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { endEmployeePersonalDetails } from "@/app/[locale]/(app)/settings/employees/personal-details-actions";
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
import type { Translate } from "@/lib/organization-action/action-error-message";
import type {
	PersonalDetailsPart,
	PersonalDetailsRefusalDetails,
} from "@/lib/organization/personal-details/types";
import { parseValidFrom } from "@/lib/organization/personal-details/validation";
import { fieldRefusalMessage, PERSONAL_DETAILS_REFUSALS } from "./personal-details-copy";

/** The end form's words for each part; one static `t()` call per key for the extractor. */
function endCopy(t: Translate, part: PersonalDetailsPart) {
	return part === "bank_account"
		? {
				title: t("settings.personalDetails.bankAccount.endTitle", "End bank account"),
				help: t(
					"settings.personalDetails.bankAccount.endHelp",
					"From this date no bank account is on file. Earlier history is kept; entries after this date are removed. The employee is notified.",
				),
				ended: t(
					"settings.personalDetails.bankAccount.ended",
					"Bank account ended. The employee has been notified.",
				),
				failed: t(
					"settings.personalDetails.bankAccount.endFailed",
					"Could not end the bank account. Try again.",
				),
				submit: t("settings.personalDetails.bankAccount.end", "End bank account"),
			}
		: {
				title: t("settings.personalDetails.healthInsurance.endTitle", "End health insurance"),
				help: t(
					"settings.personalDetails.healthInsurance.endHelp",
					"From this date no health insurance is on file. Earlier history is kept; entries after this date are removed. The employee is notified.",
				),
				ended: t(
					"settings.personalDetails.healthInsurance.ended",
					"Health insurance ended. The employee has been notified.",
				),
				failed: t(
					"settings.personalDetails.healthInsurance.endFailed",
					"Could not end the health insurance. Try again.",
				),
				submit: t("settings.personalDetails.healthInsurance.end", "End health insurance"),
			};
}

/**
 * Ends a part of an employee's personal details from a day (#2071, #2070), for
 * example after it was entered on the wrong employee: nothing is on file for it
 * from that day, and the employee is told.
 */
export function EndPersonalDetailsForm({
	employeeId,
	part,
	today,
	onEnded,
	onCancel,
}: {
	employeeId: string;
	part: PersonalDetailsPart;
	/** Today in the organization's timezone, YYYY-MM-DD: the default end day. */
	today: string;
	onEnded: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const [error, setError] = useState<string | null>(null);
	const [serverError, setServerError] = useState<string | undefined>(undefined);
	const copy = endCopy(t, part);

	const form = useForm({
		defaultValues: { validFrom: today },
		onSubmit: async ({ value }) => {
			setError(null);
			setServerError(undefined);
			try {
				const result = await endEmployeePersonalDetails({
					employeeId,
					part,
					validFrom: value.validFrom,
				});
				if (result.success) {
					toast.success(copy.ended);
					onEnded();
					return;
				}
				const code = (result.details as PersonalDetailsRefusalDetails | undefined)?.fields
					?.validFrom;
				setServerError(code ? fieldRefusalMessage(t, code) : undefined);
				setError(actionErrorMessage(t, result, PERSONAL_DETAILS_REFUSALS, () => copy.failed));
			} catch {
				setError(copy.failed);
			}
		},
	});

	return (
		<form
			noValidate
			aria-label={copy.title}
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
						<TFormDescription>{copy.help}</TFormDescription>
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
							{copy.submit}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
