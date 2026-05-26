"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
	applyFontSizePreference,
	type FontSizePreference,
	readStoredFontSize,
	writeStoredFontSize,
} from "./font-size-preference-utils";

type FontSizeContextValue = {
	fontSize: FontSizePreference;
	setFontSize: (value: FontSizePreference) => void;
};

const FontSizeContext = createContext<FontSizeContextValue | null>(null);

function getLocalStorage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
	const [fontSize, setFontSizeState] = useState<FontSizePreference>(() =>
		readStoredFontSize(getLocalStorage()),
	);

	useEffect(() => {
		applyFontSizePreference(fontSize);
	}, [fontSize]);

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
