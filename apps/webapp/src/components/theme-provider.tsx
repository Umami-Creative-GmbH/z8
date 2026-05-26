"use client";

// Note: Temporal polyfill is loaded dynamically in schedule-x-wrapper.tsx
// before Schedule-X is rendered (required for Schedule-X v3+).

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark" | "system";

type ThemeProviderProps = {
	children: React.ReactNode;
	attribute?: "class" | `data-${string}` | Array<"class" | `data-${string}`>;
	defaultTheme?: Theme;
	disableTransitionOnChange?: boolean;
	enableColorScheme?: boolean;
	enableSystem?: boolean;
	storageKey?: string;
	themes?: string[];
	value?: Record<string, string>;
};

type ThemeContextValue = {
	forcedTheme?: string;
	resolvedTheme?: "light" | "dark";
	setTheme: React.Dispatch<React.SetStateAction<string>>;
	systemTheme?: "light" | "dark";
	theme?: string;
	themes: string[];
};

const DEFAULT_THEMES = ["light", "dark"];
const ThemeContext = createContext<ThemeContextValue>({
	setTheme: () => {},
	themes: [],
});

function getLocalStorage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined" || !window.matchMedia) {
		return "light";
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: string | undefined, enableSystem: boolean): "light" | "dark" {
	return enableSystem && theme === "system"
		? getSystemTheme()
		: theme === "dark"
			? "dark"
			: "light";
}

function writeStoredTheme(storageKey: string, theme: string) {
	try {
		getLocalStorage()?.setItem(storageKey, theme);
	} catch {
		// Keep the current session updated even when persistence is blocked.
	}
}

function disableTransitionsTemporarily() {
	if (typeof document === "undefined") {
		return;
	}

	const css = document.createElement("style");
	css.appendChild(document.createTextNode("*,*::before,*::after{transition:none!important}"));
	document.head.appendChild(css);

	window.getComputedStyle(document.body);
	setTimeout(() => css.remove(), 1);
}

function applyTheme({
	attribute,
	enableColorScheme,
	resolvedTheme,
	themes,
	value,
}: {
	attribute: NonNullable<ThemeProviderProps["attribute"]>;
	enableColorScheme: boolean;
	resolvedTheme: "light" | "dark";
	themes: string[];
	value?: Record<string, string>;
}) {
	if (typeof document === "undefined") {
		return;
	}

	const html = document.documentElement;
	const attributes = Array.isArray(attribute) ? attribute : [attribute];
	const resolvedValue = value?.[resolvedTheme] ?? resolvedTheme;
	const values = value ? Object.values(value) : themes;

	for (const item of attributes) {
		if (item === "class") {
			html.classList.remove(...values);
			html.classList.add(resolvedValue);
		} else {
			html.setAttribute(item, resolvedValue);
		}
	}

	if (enableColorScheme) {
		html.style.colorScheme = resolvedTheme;
	}
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
	const {
		attribute = "data-theme",
		defaultTheme,
		disableTransitionOnChange = false,
		enableColorScheme = true,
		enableSystem = true,
		storageKey = "theme",
		themes = DEFAULT_THEMES,
		value,
	} = props;
	const initialTheme = defaultTheme ?? (enableSystem ? "system" : "light");
	const [theme, setThemeState] = useState<string>(() => {
		try {
			return getLocalStorage()?.getItem(storageKey) ?? initialTheme;
		} catch {
			return initialTheme;
		}
	});
	const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => getSystemTheme());
	const resolvedTheme = resolveTheme(theme, enableSystem);

	useEffect(() => {
		if (!enableSystem || typeof window === "undefined" || !window.matchMedia) {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");
		updateSystemTheme();
		media.addEventListener("change", updateSystemTheme);

		return () => media.removeEventListener("change", updateSystemTheme);
	}, [enableSystem]);

	useEffect(() => {
		applyTheme({ attribute, enableColorScheme, resolvedTheme, themes, value });
	}, [attribute, enableColorScheme, resolvedTheme, themes, value]);

	const setTheme = useCallback<React.Dispatch<React.SetStateAction<string>>>(
		(nextTheme) => {
			setThemeState((currentTheme) => {
				const value = typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme;
				if (disableTransitionOnChange) {
					disableTransitionsTemporarily();
				}
				writeStoredTheme(storageKey, value);
				return value;
			});
		},
		[disableTransitionOnChange, storageKey],
	);

	const context = useMemo<ThemeContextValue>(
		() => ({
			resolvedTheme,
			setTheme,
			systemTheme,
			theme,
			themes: enableSystem ? [...themes, "system"] : themes,
		}),
		[enableSystem, resolvedTheme, setTheme, systemTheme, theme, themes],
	);

	return <ThemeContext.Provider value={context}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	return useContext(ThemeContext);
}
