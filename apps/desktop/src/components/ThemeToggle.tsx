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
  const cycleTheme = () => {
    if (theme === "system") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("system");
  };
  const IconTheme = theme === "system" ? IconDeviceDesktop : resolvedTheme === "dark" ? IconMoon : IconSun;
  const themeLabel = theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="settings-button"
      title={`Theme: ${themeLabel}`}
      aria-label={`${labelPrefix}. Current theme: ${themeLabel}`}
    >
      <IconTheme size={18} />
    </button>
  );
}
