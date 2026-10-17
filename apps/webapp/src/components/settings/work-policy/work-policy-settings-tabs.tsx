"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";

export function WorkPolicySettingsTabs({
	panels,
}: {
	panels: Record<"work" | "changes", ReactNode>;
}) {
	const { t } = useTranslate();
	return (
		<SettingsTabbedPage
			title={t("settings.workPolicies.title", "Work Policies")}
			defaultTab="work"
			tabs={[
				{
					value: "work",
					label: t("settings.workPolicies.title", "Work Policies"),
					description: t(
						"settings.workPolicies.description",
						"Manage work schedules, time limits, and break requirements for your organization",
					),
					panel: panels.work,
				},
				{
					value: "changes",
					label: t("settings.changePolicies.title", "Change Policies"),
					description: t(
						"settings.changePolicies.description",
						"Control when employees can edit their time tracking entries and when manager approval is required",
					),
					panel: panels.changes,
				},
			]}
		/>
	);
}
