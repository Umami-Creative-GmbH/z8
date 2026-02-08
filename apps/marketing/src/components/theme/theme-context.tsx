"use client";

import { createContext, useContext, useState, useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import { themes, type ThemeTokens } from "./tokens";

interface ThemeContextValue {
	t: ThemeTokens;
	dark: boolean;
	toggle: () => void;
	mounted: boolean;
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
	const [mounted, setMounted] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const t = dark ? themes.dark : themes.light;

	useEffect(() => {
		setMounted(true);
	}, []);

	// Sync CSS custom properties on <html> and the wrapper div when theme changes
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.theme = dark ? "dark" : "light";
		for (const [key, value] of Object.entries(t)) {
			root.style.setProperty(`--z8-${key}`, value);
		}
	}, [dark, t]);

	const toggle = () => {
		setDark((d) => {
			try {
				localStorage.setItem("z8-theme", d ? "light" : "dark");
			} catch {}
			return !d;
		});
	};

	// Generate CSS custom properties from current theme tokens
	const cssVars: Record<string, string> = {};
	for (const [key, value] of Object.entries(t)) {
		cssVars[`--z8-${key}`] = value;
	}

	return (
		<ThemeContext value={{ t, dark, toggle, mounted }}>
			<div
				ref={wrapperRef}
				className="min-h-screen"
				style={{
					...cssVars,
					fontFamily: "'Satoshi', 'General Sans', 'Switzer', 'Cerebri Sans', sans-serif",
					backgroundColor: "var(--z8-bg)",
					color: "var(--z8-text)",
					transition: "background-color 0.4s ease, color 0.4s ease",
				} as CSSProperties}
			>
				{children}
			</div>
		</ThemeContext>
	);
}

export function useThemeTokens(): ThemeContextValue {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error("useThemeTokens must be used within ThemeProvider");
	return ctx;
}
