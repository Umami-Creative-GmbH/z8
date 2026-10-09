"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePersonnelFileExpiryLeadDaysAction } from "@/app/[locale]/(app)/settings/personnel-files/reminder-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	MAX_EXPIRY_REMINDER_LEAD_DAYS,
	MIN_EXPIRY_REMINDER_LEAD_DAYS,
	validateExpiryReminderLeadDays,
} from "@/lib/personnel-file/expiry";

/**
 * Settings → Personnel files → Reminders (#869): how many days before an
 * expiry date officers and employees get the upcoming reminder. The
 * expired-today reminder is always sent on the expiry date.
 */
export function ExpiryReminderSettingsCard({ leadDays }: { leadDays: number }) {
	const { t } = useTranslate();
	const router = useRouter();
	const form = useForm({
		defaultValues: { leadDays: String(leadDays) },
		onSubmit: async ({ value }) => {
			const result = await savePersonnelFileExpiryLeadDaysAction({ leadDays: value.leadDays });
			if (!result.success) {
				toast.error(
					t(
						"settings.personnelFiles.reminders.saveFailed",
						"The reminder lead time could not be saved.",
					),
				);
				return;
			}
			toast.success(t("settings.personnelFiles.reminders.saved", "Reminder lead time saved"));
			router.refresh();
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.personnelFiles.reminders.title", "Expiry reminders")}</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.reminders.intro",
						"Certificates and other documents with an expiry date send a reminder within the lead time and another on the expiry date. Officers covering the employee are reminded, or owners and admins when no officer does, and the employee too if the document is shared.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{/* Client-side TanStack Form submit (docs/refs/forms.md); the settings page needs JS. */}
				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="space-y-4"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="leadDays"
						validators={{
							onChange: ({ value }) =>
								validateExpiryReminderLeadDays(value).ok
									? undefined
									: t(
											"settings.personnelFiles.reminders.leadDaysInvalid",
											"Enter a lead time between {min} and {max} days.",
											{ min: MIN_EXPIRY_REMINDER_LEAD_DAYS, max: MAX_EXPIRY_REMINDER_LEAD_DAYS },
										),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t(
										"settings.personnelFiles.reminders.leadDays",
										"Expiry reminder lead time (days)",
									)}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										className="sm:w-40"
										type="number"
										inputMode="numeric"
										min={MIN_EXPIRY_REMINDER_LEAD_DAYS}
										max={MAX_EXPIRY_REMINDER_LEAD_DAYS}
										step={1}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.personnelFiles.reminders.leadDaysDescription",
										"Days are counted in the organization's timezone. Changing a document's expiry date sends both reminders again.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting && (
									<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
								)}
								{t("settings.personnelFiles.reminders.save", "Save lead time")}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
