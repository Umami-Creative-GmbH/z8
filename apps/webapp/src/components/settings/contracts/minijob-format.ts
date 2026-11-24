import type { useTranslate } from "@tolgee/react";
import type { MinijobExceedanceStatus } from "@/lib/statutory/minijob/minijob-months";

// Shared Minijob monitor formatting (#1989): Employee Detail card and Reviews & Conflicts.

type Translate = ReturnType<typeof useTranslate>["t"];

export function formatMinijobMonth(month: string, locale: string): string {
	const [year, monthNumber] = month.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1)));
}

export function formatEuroCents(cents: number, locale: string, currency = "EUR"): string {
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function minijobExceedanceLabel(status: MinijobExceedanceStatus, t: Translate): string {
	switch (status) {
		case "acknowledged":
			return t("settings.contracts.minijob.exceedance.acknowledged", "Documented as unforeseeable");
		case "unacknowledged":
			return t("settings.contracts.minijob.exceedance.unacknowledged", "Not documented");
		case "stale":
			return t(
				"settings.contracts.minijob.exceedance.stale",
				"Documentation outdated: work or shifts changed",
			);
		case "over_double_cap":
			return t("settings.contracts.minijob.exceedance.overDoubleCap", "More than twice the limit");
		case "too_many_exceedances":
			return t(
				"settings.contracts.minijob.exceedance.tooMany",
				"Too many exceedance months within 12 months",
			);
	}
}
