import {
	IconBriefcase,
	IconBulb,
	IconChartBar,
	IconCloud,
	IconCode,
	IconDatabase,
	IconDevices,
	IconPalette,
	IconRocket,
	IconSettings,
	IconShoppingCart,
	IconUsers,
} from "@tabler/icons-react";

/** The colour swatches offered for projects and project templates. */
export const PROJECT_COLOR_OPTIONS = [
	"#ef4444", // red
	"#f97316", // orange
	"#eab308", // yellow
	"#22c55e", // green
	"#14b8a6", // teal
	"#3b82f6", // blue
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#6b7280", // gray
] as const;

/**
 * The icons offered for project templates, stored by Tabler component name
 * (the `icon` column holds that name).
 */
export const PROJECT_ICON_OPTIONS = {
	IconBriefcase,
	IconBulb,
	IconChartBar,
	IconCloud,
	IconCode,
	IconDatabase,
	IconDevices,
	IconPalette,
	IconRocket,
	IconSettings,
	IconShoppingCart,
	IconUsers,
} as const;

export type ProjectIconName = keyof typeof PROJECT_ICON_OPTIONS;

export function isProjectIconName(value: string | null | undefined): value is ProjectIconName {
	return !!value && Object.hasOwn(PROJECT_ICON_OPTIONS, value);
}
