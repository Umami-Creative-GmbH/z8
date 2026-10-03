import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import { normalizeTimeFormat, type TimeFormat } from "./time-format";
import { normalizeWeekStartDay, type WeekStartDay } from "./week-start";

export type RenderUserPreferences = {
	locale: string | null;
	weekStartDay: WeekStartDay;
	timeFormat: TimeFormat;
	timezone: string;
	helpImproveProduct: boolean;
};

export async function readUserPreferences(
	userId: string,
): Promise<RenderUserPreferences> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: {
			locale: true,
			weekStartDay: true,
			timeFormat: true,
			timezone: true,
			helpImproveProduct: true,
		},
	});

	return {
		locale:
			settings?.locale && ALL_LANGUAGES.includes(settings.locale)
				? settings.locale
				: null,
		weekStartDay: normalizeWeekStartDay(settings?.weekStartDay),
		timeFormat: normalizeTimeFormat(settings?.timeFormat),
		timezone: settings?.timezone || "UTC",
		helpImproveProduct: settings?.helpImproveProduct ?? true,
	};
}

// Only share preferences within an RSC request, keyed by the authorized user's ID.
export const getRenderUserPreferences = cache(readUserPreferences);
