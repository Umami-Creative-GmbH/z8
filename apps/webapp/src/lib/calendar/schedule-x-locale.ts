import type { TimeFormat } from "@/lib/user-preferences/time-format";

// Every app language maps explicitly; `language-coverage.test.ts` fails when one is missing.
export const SCHEDULE_X_LOCALES: Readonly<Record<string, string>> = {
	en: "en-US",
	de: "de-DE",
	fr: "fr-FR",
	es: "es-ES",
	it: "it-IT",
	pt: "pt-BR",
	// Schedule-X has no Greek; British English keeps day-month order.
	el: "en-GB",
	pl: "pl-PL",
	tr: "tr-TR",
	// Swiss German writes dates in Standard German.
	gsw: "de-DE",
	no: "nb-NO",
	sv: "sv-SE",
	ro: "ro-RO",
	hr: "hr-HR",
	// Schedule-X has no Bosnian; Croatian shares its Latin script and ijekavian forms.
	bs: "hr-HR",
	// Schedule-X has no Albanian; British English keeps day-month order.
	sq: "en-GB",
	uk: "uk-UA",
	ru: "ru-RU",
};

export function toScheduleXLocale(language: string | undefined): string {
	return SCHEDULE_X_LOCALES[language ?? ""] ?? SCHEDULE_X_LOCALES.en;
}

/**
 * Schedule-X's `weekOptions.timeAxisFormatOptions` for the user's 12/24-hour setting. Schedule-X
 * accepts only `xx-YY` locales, so the hour cycle can't ride on the locale (`-u-hc-h23`); its
 * event times ignore this option and are drawn by our own event components instead.
 */
export function scheduleXTimeAxisFormat(timeFormat: TimeFormat): Intl.DateTimeFormatOptions {
	return timeFormat === "12h"
		? { hour: "numeric", hourCycle: "h12" }
		: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
}
