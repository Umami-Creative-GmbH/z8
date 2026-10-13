"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSkillReminderLeadDays } from "@/app/[locale]/(app)/settings/skills/actions";
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
} from "@/lib/expiry-reminders/expiry";
import { queryKeys } from "@/lib/query/keys";

/**
 * Settings → Skills (#1143): how many days before a skill expiry date the
 * employee and their managers get the "expires soon" reminder, and from when
 * the "Expiring soon" badge shows. The "expires today" reminder is always sent
 * on the date. Owners and admins only.
 */
export function SkillReminderSettingsCard({ leadDays }: { leadDays: number }) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: { leadDays: String(leadDays) },
		onSubmit: async ({ value }) => {
			const result = await saveSkillReminderLeadDays({ leadDays: value.leadDays });
			if (!result.success) {
				toast.error(
					t("settings.skills.reminders.saveFailed", "The reminder lead time could not be saved."),
				);
				return;
			}
			toast.success(t("settings.skills.reminders.saved", "Reminder lead time saved"));
			// The "Expiring soon" badges count from the same lead time.
			await queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
			router.refresh();
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.skills.reminders.title", "Skill expiry reminders")}</CardTitle>
				<CardDescription>
					{t(
						"settings.skills.reminders.intro",
						'Employee skills with an expiry date send a reminder within the lead time and another on the expiry date. The employee and their managers are reminded, or owners and admins when the employee has no manager. The "Expiring soon" badge uses the same lead time.',
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
											"settings.skills.reminders.leadDaysInvalid",
											"Enter a lead time between {min} and {max} days.",
											{ min: MIN_EXPIRY_REMINDER_LEAD_DAYS, max: MAX_EXPIRY_REMINDER_LEAD_DAYS },
										),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.skills.reminders.leadDays", "Skill reminder lead time (days)")}
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
										"settings.skills.reminders.leadDaysDescription",
										"Days are counted in the organization's timezone. Changing a skill's expiry date sends both reminders again.",
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
								{t("settings.skills.reminders.save", "Save lead time")}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
