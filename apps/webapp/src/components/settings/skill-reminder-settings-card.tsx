"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSkillReminderLeadDays } from "@/app/[locale]/(app)/settings/skills/actions";
import { ExpiryReminderLeadTimeCard } from "@/components/settings/expiry-reminder-lead-time-card";
import {
	MAX_EXPIRY_REMINDER_LEAD_DAYS,
	MIN_EXPIRY_REMINDER_LEAD_DAYS,
} from "@/lib/expiry-reminders/expiry";
import { queryKeys } from "@/lib/query/keys";

export function SkillReminderSettingsCard({ leadDays }: { leadDays: number }) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	async function save(leadDays: string) {
		const value = { leadDays };
		const result = await saveSkillReminderLeadDays({
			leadDays: value.leadDays,
		});
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
	}
	return (
		<ExpiryReminderLeadTimeCard
			leadDays={leadDays}
			onSave={save}
			labels={{
				title: t("settings.skills.reminders.title", "Skill expiry reminders"),
				description: t(
					"settings.skills.reminders.intro",
					'Employee skills with an expiry date send a reminder within the lead time and another on the expiry date. The employee and their managers are reminded, or owners and admins when the employee has no manager. The "Expiring soon" badge uses the same lead time.',
				),
				leadDays: t("settings.skills.reminders.leadDays", "Skill reminder lead time (days)"),
				help: t(
					"settings.skills.reminders.leadDaysDescription",
					"Days are counted in the organization's timezone. Changing a skill's expiry date sends both reminders again.",
				),
				save: t("settings.skills.reminders.save", "Save lead time"),
				invalid: t(
					"settings.skills.reminders.leadDaysInvalid",
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
