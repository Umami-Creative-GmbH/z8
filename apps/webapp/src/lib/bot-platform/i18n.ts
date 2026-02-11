/**
 * Bot Platform - i18n
 *
 * Standalone translator for bot commands and proactive messages.
 * Runs outside of Next.js request context (no headers/cookies).
 */

import { eq } from "drizzle-orm";
import type { DateTime } from "luxon";
import { db } from "@/db";
import { userSettings } from "@/db/schema/user-settings";
import {
	ALL_LANGUAGES,
	DEFAULT_LANGUAGE,
	TolgeeBase,
	loadNamespaces,
} from "@/tolgee/shared";

/** The translate function signature returned by getBotTranslate */
export type BotTranslateFn = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

// ============================================
// LOCALE-AWARE DATE FORMATTING
// Uses Intl.DateTimeFormat via Luxon's toLocaleString.
// ============================================

/** "Jan 15" / "15. Jan." */
export function fmtShortDate(dt: DateTime, locale: string): string {
	return dt.toLocaleString({ month: "short", day: "numeric" }, { locale });
}

/** "Jan 15, 14:30" / "15. Jan., 14:30" */
export function fmtShortDateTime(dt: DateTime, locale: string): string {
	return dt.toLocaleString(
		{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
		{ locale },
	);
}

/** "Monday, January 15, 2024" / "Montag, 15. Januar 2024" */
export function fmtFullDate(dt: DateTime, locale: string): string {
	return dt.toLocaleString(
		{ weekday: "long", year: "numeric", month: "long", day: "numeric" },
		{ locale },
	);
}

/** "January 15, 2024" / "15. Januar 2024" */
export function fmtLongDate(dt: DateTime, locale: string): string {
	return dt.toLocaleString(
		{ year: "numeric", month: "long", day: "numeric" },
		{ locale },
	);
}

/** "14:30" / "2:30 PM" */
export function fmtTime(dt: DateTime, locale: string): string {
	return dt.toLocaleString({ hour: "2-digit", minute: "2-digit" }, { locale });
}

/** "Mon, Jan 15" / "Mo., 15. Jan." */
export function fmtWeekdayShortDate(dt: DateTime, locale: string): string {
	return dt.toLocaleString(
		{ weekday: "short", month: "short", day: "numeric" },
		{ locale },
	);
}

/** "Mon, Jan 15, 2024" / "Mo., 15. Jan. 2024" */
export function fmtWeekdayShortDateYear(dt: DateTime, locale: string): string {
	return dt.toLocaleString(
		{ weekday: "short", year: "numeric", month: "short", day: "numeric" },
		{ locale },
	);
}

/** "Mon, Jan 15, 14:30" / "Mo., 15. Jan., 14:30" */
export function fmtWeekdayShortDateTime(dt: DateTime, locale: string): string {
	return dt.toLocaleString(
		{ weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
		{ locale },
	);
}

/**
 * Get the user's persisted locale from the database.
 * Falls back to DEFAULT_LANGUAGE if not set.
 */
export async function getUserLocale(userId: string): Promise<string> {
	const locale = await getUserLocaleRaw(userId);
	return locale ?? DEFAULT_LANGUAGE;
}

/**
 * Get the user's persisted locale from the database.
 * Returns null if no locale preference has been set.
 */
export async function getUserLocaleRaw(userId: string): Promise<string | null> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { locale: true },
	});

	const locale = settings?.locale;
	if (locale && ALL_LANGUAGES.includes(locale)) {
		return locale;
	}

	return null;
}

/**
 * Persist the user's locale preference to the database.
 * Upserts into userSettings.
 */
export async function setUserLocale(
	userId: string,
	locale: string,
): Promise<void> {
	if (!ALL_LANGUAGES.includes(locale)) return;

	const existing = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { id: true },
	});

	if (existing) {
		await db
			.update(userSettings)
			.set({ locale })
			.where(eq(userSettings.userId, userId));
	} else {
		await db.insert(userSettings).values({
			userId,
			locale,
		});
	}
}

/**
 * Create a standalone translate function for bot messages.
 * Uses the "bot" namespace and operates without Next.js request context.
 */
export async function getBotTranslate(
	locale: string,
): Promise<BotTranslateFn> {
	const lang = ALL_LANGUAGES.includes(locale) ? locale : DEFAULT_LANGUAGE;
	const staticData = await loadNamespaces(lang, ["bot"]);

	const tolgee = TolgeeBase().init({
		language: lang,
		staticData,
	});

	await tolgee.run();

	return (
		key: string,
		defaultValue: string,
		params?: Record<string, string | number>,
	): string => {
		return tolgee.t({ key, defaultValue, params });
	};
}
