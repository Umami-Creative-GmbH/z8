import { englishMonthLabel } from "./refusal";
import { type ClosedMonthKey, firstDayOfMonth } from "./rules";

const MONTH_CLOSED_FALLBACK =
	"{month} is closed. It must be reopened before its work or absences can change.";

function interpolate(template: string, params: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

function monthLabel(month: ClosedMonthKey, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		}).format(new Date(`${firstDayOfMonth(month)}T00:00:00Z`));
	} catch {
		return englishMonthLabel(month);
	}
}

/**
 * The words of the "month closed" refusal (#762) in the request's language.
 * Outside a request scope (background callers, tests) it is English.
 */
export async function monthClosedMessage(month: ClosedMonthKey): Promise<string> {
	try {
		const { getTolgee, getTranslate } = await import("@/tolgee/server");
		const [tolgee, t] = await Promise.all([getTolgee(), getTranslate()]);
		const locale = tolgee.getLanguage() ?? "en";
		return t("common.errors.monthClosed", MONTH_CLOSED_FALLBACK, {
			month: monthLabel(month, locale),
		});
	} catch {
		return interpolate(MONTH_CLOSED_FALLBACK, { month: englishMonthLabel(month) });
	}
}
