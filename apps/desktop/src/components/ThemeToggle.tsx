import { useI18n } from "../lib/i18n";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import type { useTheme } from "../hooks/useTheme";

type ThemeToggleProps = ReturnType<typeof useTheme> & {
	labelPrefix?: string;
};

export function ThemeToggle({
	theme,
	setTheme,
	resolvedTheme,
	labelPrefix = "Change theme",
}: ThemeToggleProps) {
	const { t } = useI18n();
	const cycleTheme = () => {
		if (theme === "system") setTheme("light");
		else if (theme === "light") setTheme("dark");
		else setTheme("system");
	};
	const IconTheme =
		theme === "system"
			? IconDeviceDesktop
			: resolvedTheme === "dark"
				? IconMoon
				: IconSun;
	const themeLabel =
		theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";

	return (
		<button
			type="button"
			onClick={cycleTheme}
			className="settings-button"
			title={`${t("Current theme")}: ${t(themeLabel)}`}
			aria-label={`${t(labelPrefix)}. ${t("Current theme")}: ${t(themeLabel)}`}
		>
			<IconTheme size={18} />
		</button>
	);
}
