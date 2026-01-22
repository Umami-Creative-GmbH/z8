import { useState, useEffect } from "react";

export type Theme = "system" | "light" | "dark";

const THEME_KEY = "z8-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(THEME_KEY) as Theme) || "system";
    }
    return "system";
  });

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  };

  useEffect(() => {
    const root = document.documentElement;

    // Remove existing theme classes
    root.classList.remove("light", "dark");

    if (theme === "system") {
      // Let CSS media query handle it
      return;
    }

    // Force the theme
    root.classList.add(theme);
  }, [theme]);

  // Get the actual resolved theme (for UI display)
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  return { theme, setTheme, resolvedTheme };
}
