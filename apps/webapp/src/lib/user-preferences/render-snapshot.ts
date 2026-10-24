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

async function readUserSettings(userId: string) {
	return db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: {
			locale: true,
			weekStartDay: true,
			timeFormat: true,
			timezone: true,
			helpImproveProduct: true,
			onboardingComplete: true,
			onboardingStep: true,
			dashboardWidgetOrder: true,
		},
	});
}

export const getRenderUserSettings = cache(readUserSettings);

function preferencesFromSettings(
	settings: Awaited<ReturnType<typeof readUserSettings>>,
): RenderUserPreferences {
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

export async function readUserPreferences(
	userId: string,
): Promise<RenderUserPreferences> {
	return preferencesFromSettings(await readUserSettings(userId));
}

// Presentation and Dashboard onboarding share one user-settings read in RSC.
export const getRenderUserPreferences = cache(async (userId: string) =>
	preferencesFromSettings(await getRenderUserSettings(userId)),
);
