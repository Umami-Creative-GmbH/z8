import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeWeekStartDay, type WeekStartDay } from "./week-start";

export async function getUserWeekStartDay(userId: string): Promise<WeekStartDay> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { weekStartDay: true },
	});

	return normalizeWeekStartDay(settings?.weekStartDay);
}
