"use client";

import { createContext, use, useEffect, useState } from "react";
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

	const setFontSize = (value: FontSizePreference) => {
		setFontSizeState(value);
		writeStoredFontSize(getLocalStorage(), value);
		applyFontSizePreference(value);
	};

	const value = {
		fontSize,
		setFontSize,
	};

	return <FontSizeContext.Provider value={value}>{children}</FontSizeContext.Provider>;
}

export function useFontSizePreference() {
	const context = use(FontSizeContext);

	if (!context) {
		throw new Error("useFontSizePreference must be used within FontSizeProvider");
	}

	return context;
}
