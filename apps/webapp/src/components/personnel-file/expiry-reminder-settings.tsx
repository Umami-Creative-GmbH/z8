"use client";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePersonnelFileExpiryLeadDaysAction } from "@/app/[locale]/(app)/settings/personnel-files/reminder-actions";
import { ExpiryReminderLeadTimeCard } from "@/components/settings/expiry-reminder-lead-time-card";
import {
	MAX_EXPIRY_REMINDER_LEAD_DAYS,
	MIN_EXPIRY_REMINDER_LEAD_DAYS,
} from "@/lib/expiry-reminders/expiry";

export function ExpiryReminderSettingsCard({ leadDays }: { leadDays: number }) {
	const { t } = useTranslate();
	const router = useRouter();
	async function save(leadDays: string) {
		const value = { leadDays };
		const result = await savePersonnelFileExpiryLeadDaysAction({
			leadDays: value.leadDays,
		});
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
	}
	return (
		<ExpiryReminderLeadTimeCard
			leadDays={leadDays}
			onSave={save}
			labels={{
				title: t("settings.personnelFiles.reminders.title", "Expiry reminders"),
				description: t(
					"settings.personnelFiles.reminders.intro",
					"Certificates and other documents with an expiry date send a reminder within the lead time and another on the expiry date. Officers covering the employee are reminded, or owners and admins when no officer does, and the employee too if the document is shared.",
				),
				leadDays: t(
					"settings.personnelFiles.reminders.leadDays",
					"Expiry reminder lead time (days)",
				),
				help: t(
					"settings.personnelFiles.reminders.leadDaysDescription",
					"Days are counted in the organization's timezone. Changing a document's expiry date sends both reminders again.",
				),
				save: t("settings.personnelFiles.reminders.save", "Save lead time"),
				invalid: t(
					"settings.personnelFiles.reminders.leadDaysInvalid",
					"Enter a lead time between {min} and {max} days.",
					{
						min: MIN_EXPIRY_REMINDER_LEAD_DAYS,
						max: MAX_EXPIRY_REMINDER_LEAD_DAYS,
					},
				),
			}}
		/>
	);
}
