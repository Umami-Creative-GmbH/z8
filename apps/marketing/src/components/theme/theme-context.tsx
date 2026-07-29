"use client";

import {
	type CSSProperties,
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type ThemeTokens, themes } from "./tokens";

interface ThemeContextValue {
	t: ThemeTokens;
	dark: boolean;
	toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialDark(): boolean {
	if (typeof document !== "undefined") {
		return document.documentElement.dataset.theme === "dark";
	}
	return false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [dark, setDark] = useState(getInitialDark);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const t = dark ? themes.dark : themes.light;

	// Sync browser state only after React commits the selected theme.
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.theme = dark ? "dark" : "light";
		for (const [key, value] of Object.entries(t)) {
			root.style.setProperty(`--z8-${key}`, value);
		}
		try {
			localStorage.setItem("z8-theme", dark ? "dark" : "light");
		} catch {}
	}, [dark, t]);

	const toggle = useCallback(() => {
		setDark((current) => !current);
	}, []);
	const contextValue = useMemo(() => ({ t, dark, toggle }), [t, dark, toggle]);

	// Generate CSS custom properties from current theme tokens
	const cssVars: Record<string, string> = {};
	for (const [key, value] of Object.entries(t)) {
		cssVars[`--z8-${key}`] = value;
	}

	return (
		<ThemeContext value={contextValue}>
			<div
				ref={wrapperRef}
				className="min-h-screen"
				style={
					{
						...cssVars,
						fontFamily:
							"'Satoshi', 'General Sans', 'Switzer', 'Cerebri Sans', sans-serif",
						backgroundColor: "var(--z8-bg)",
						color: "var(--z8-text)",
						transition: "background-color 0.4s ease, color 0.4s ease",
					} as CSSProperties
				}
			>
				{children}
			</div>
		</ThemeContext>
	);
}

export function useThemeTokens(): ThemeContextValue {
	const ctx = use(ThemeContext);
	if (!ctx) throw new Error("useThemeTokens must be used within ThemeProvider");
	return ctx;
}
