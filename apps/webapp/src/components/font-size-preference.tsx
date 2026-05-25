"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const FONT_SIZE_STORAGE_KEY = "z8-font-size";

export type FontSizePreference = "default" | "comfortable" | "large";

export const FONT_SIZE_OPTIONS: Array<{ value: FontSizePreference; labelKey: string; label: string }> = [
	{ value: "default", labelKey: "user.font-size-default", label: "Default" },
	{ value: "comfortable", labelKey: "user.font-size-comfortable", label: "Comfortable" },
	{ value: "large", labelKey: "user.font-size-large", label: "Large" },
];

type FontSizeContextValue = {
	fontSize: FontSizePreference;
	setFontSize: (value: FontSizePreference) => void;
};

const FontSizeContext = createContext<FontSizeContextValue | null>(null);

export function isFontSizePreference(value: string | null): value is FontSizePreference {
	return value === "default" || value === "comfortable" || value === "large";
}

export function readStoredFontSize(storage: Storage | undefined): FontSizePreference {
	try {
		const value = storage?.getItem(FONT_SIZE_STORAGE_KEY) ?? null;
		return isFontSizePreference(value) ? value : "default";
	} catch {
		return "default";
	}
}

export function writeStoredFontSize(storage: Storage | undefined, value: FontSizePreference) {
	try {
		storage?.setItem(FONT_SIZE_STORAGE_KEY, value);
	} catch {
		// Keep the current session updated even when persistence is blocked.
	}
}

function getLocalStorage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

export function applyFontSizePreference(value: FontSizePreference) {
	if (typeof document === "undefined") {
		return;
	}

	if (value === "default") {
		document.documentElement.removeAttribute("data-font-size");
		return;
	}

	document.documentElement.dataset.fontSize = value;
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
	const [fontSize, setFontSizeState] = useState<FontSizePreference>("default");

	useEffect(() => {
		const storedFontSize = readStoredFontSize(getLocalStorage());
		setFontSizeState(storedFontSize);
		applyFontSizePreference(storedFontSize);
	}, []);

	const setFontSize = useCallback((value: FontSizePreference) => {
		setFontSizeState(value);
		writeStoredFontSize(getLocalStorage(), value);
		applyFontSizePreference(value);
	}, []);

	const value = useMemo(() => ({ fontSize, setFontSize }), [fontSize, setFontSize]);

	return <FontSizeContext.Provider value={value}>{children}</FontSizeContext.Provider>;
}

export function useFontSizePreference() {
	const context = useContext(FontSizeContext);

	if (!context) {
		throw new Error("useFontSizePreference must be used within FontSizeProvider");
	}

	return context;
}
