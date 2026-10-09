"use client";

import { useTranslate } from "@tolgee/react";
import {
	isProjectIconName,
	PROJECT_ICON_OPTIONS,
	type ProjectIconName,
} from "./project-appearance";

/** The translated name of each icon a template can carry. */
export function useIconLabels(): Record<ProjectIconName, string> {
	const { t } = useTranslate();
	return {
		IconBriefcase: t("settings.projects.templates.icons.briefcase", "Briefcase"),
		IconBulb: t("settings.projects.templates.icons.bulb", "Light bulb"),
		IconChartBar: t("settings.projects.templates.icons.chartBar", "Bar chart"),
		IconCloud: t("settings.projects.templates.icons.cloud", "Cloud"),
		IconCode: t("settings.projects.templates.icons.code", "Code"),
		IconDatabase: t("settings.projects.templates.icons.database", "Database"),
		IconDevices: t("settings.projects.templates.icons.devices", "Devices"),
		IconPalette: t("settings.projects.templates.icons.palette", "Palette"),
		IconRocket: t("settings.projects.templates.icons.rocket", "Rocket"),
		IconSettings: t("settings.projects.templates.icons.settings", "Settings"),
		IconShoppingCart: t("settings.projects.templates.icons.shoppingCart", "Shopping cart"),
		IconUsers: t("settings.projects.templates.icons.users", "People"),
	};
}

/** A template's icon; nothing for none or a name outside the offered icons. */
export function TemplateIcon({ icon, className }: { icon: string | null; className?: string }) {
	if (!isProjectIconName(icon)) return null;
	const Icon = PROJECT_ICON_OPTIONS[icon];
	return <Icon className={className} aria-hidden="true" />;
}
