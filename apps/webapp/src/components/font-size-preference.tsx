"use client";

import { createContext, use, useEffect, useSyncExternalStore } from "react";
import {
	applyFontSizePreference,
	FONT_SIZE_STORAGE_KEY,
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

const FONT_SIZE_CHANGE_EVENT = "z8-font-size-change";
let inMemoryFontSize: FontSizePreference = "default";
let usesInMemoryFontSize = false;

function subscribeToFontSizePreference(onStoreChange: () => void) {
	const onStorageChange = (event: StorageEvent) => {
		if (event.key !== FONT_SIZE_STORAGE_KEY && event.key !== null) {
			return;
		}

		const storage = getLocalStorage();

		if (event.storageArea && event.storageArea !== storage) {
			return;
		}

		usesInMemoryFontSize = false;
		onStoreChange();
	};

	window.addEventListener("storage", onStorageChange);
	window.addEventListener(FONT_SIZE_CHANGE_EVENT, onStoreChange);

	return () => {
		window.removeEventListener("storage", onStorageChange);
		window.removeEventListener(FONT_SIZE_CHANGE_EVENT, onStoreChange);
	};
}

function getClientFontSizePreference() {
	if (usesInMemoryFontSize) {
		return inMemoryFontSize;
	}

	const storage = getLocalStorage();

	if (storage) {
		return readStoredFontSize(storage);
	}

	return "default";
}

function getServerFontSizePreference(): FontSizePreference {
	return "default";
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
	const fontSize = useSyncExternalStore(
		subscribeToFontSizePreference,
		getClientFontSizePreference,
		getServerFontSizePreference,
	);

	useEffect(() => {
		applyFontSizePreference(fontSize);
	}, [fontSize]);

	const setFontSize = (value: FontSizePreference) => {
		inMemoryFontSize = value;
		const storage = getLocalStorage();
		usesInMemoryFontSize = !writeStoredFontSize(storage, value);
		window.dispatchEvent(new Event(FONT_SIZE_CHANGE_EVENT));
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
