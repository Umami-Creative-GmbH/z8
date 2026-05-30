const FONT_SIZE_STORAGE_KEY = "z8-font-size";

type FontSizePreference = "default" | "comfortable" | "large";

const FONT_SIZE_OPTIONS: Array<{
	value: FontSizePreference;
	labelKey: string;
	label: string;
}> = [
	{ value: "default", labelKey: "user.font-size-default", label: "Default" },
	{
		value: "comfortable",
		labelKey: "user.font-size-comfortable",
		label: "Comfortable",
	},
	{ value: "large", labelKey: "user.font-size-large", label: "Large" },
];

function isFontSizePreference(value: string | null): value is FontSizePreference {
	return value === "default" || value === "comfortable" || value === "large";
}

function readStoredFontSize(storage: Storage | undefined): FontSizePreference {
	try {
		const value = storage?.getItem(FONT_SIZE_STORAGE_KEY) ?? null;
		return isFontSizePreference(value) ? value : "default";
	} catch {
		return "default";
	}
}

function writeStoredFontSize(storage: Storage | undefined, value: FontSizePreference) {
	try {
		storage?.setItem(FONT_SIZE_STORAGE_KEY, value);
	} catch {
		// Keep the current session updated even when persistence is blocked.
	}
}

function applyFontSizePreference(value: FontSizePreference) {
	if (typeof document === "undefined") {
		return;
	}

	if (value === "default") {
		document.documentElement.removeAttribute("data-font-size");
		return;
	}

	document.documentElement.dataset.fontSize = value;
}

export type { FontSizePreference };
export {
	applyFontSizePreference,
	FONT_SIZE_OPTIONS,
	FONT_SIZE_STORAGE_KEY,
	isFontSizePreference,
	readStoredFontSize,
	writeStoredFontSize,
};
