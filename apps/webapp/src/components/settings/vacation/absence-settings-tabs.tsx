"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";

export function AbsenceSettingsTabs({
	panels,
}: {
	panels: Record<"vacation" | "holidays", ReactNode>;
}) {
	const { t } = useTranslate();
	return (
		<SettingsTabbedPage
			title={t("nav.absences", "Absences")}
			defaultTab="vacation"
			tabs={[
				{
					value: "vacation",
					label: t("settings.vacation.title", "Vacation"),
					description: t(
						"settings.vacation.description",
						"Manage vacation policies and assignments for your organization",
					),
					panel: panels.vacation,
				},
				{
					value: "holidays",
					label: t("settings.holidays.title", "Holidays"),
					description: t(
						"settings.holidays.description",
						"Manage holiday presets and assignments for your organization",
					),
					panel: panels.holidays,
				},
			]}
		/>
	);
}
