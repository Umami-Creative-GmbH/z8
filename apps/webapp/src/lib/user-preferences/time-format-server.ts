import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeTimeFormat, type TimeFormat } from "./time-format";

export async function getUserTimeFormat(userId: string): Promise<TimeFormat> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { timeFormat: true },
	});

	return normalizeTimeFormat(settings?.timeFormat);
}
