export type Language = "en" | "de";
export function resolveLanguage(
	setting: string | undefined,
	preference: string | null | undefined,
): Language {
	const language =
		setting === "auto" || !setting
			? (preference ?? navigator.language)
			: setting;
	return language.toLowerCase().startsWith("de") ? "de" : "en";
}
