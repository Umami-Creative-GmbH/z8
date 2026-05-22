const SCHEDULE_X_LOCALES: Record<string, string> = {
	de: "de-DE",
	en: "en-US",
	es: "es-ES",
	fr: "fr-FR",
	it: "it-IT",
	pt: "pt-BR",
};

export function toScheduleXLocale(language: string | undefined): string {
	return SCHEDULE_X_LOCALES[language ?? ""] ?? SCHEDULE_X_LOCALES.en;
}
