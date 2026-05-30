import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";

export async function getUserTimezone(userId: string): Promise<string> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { timezone: true },
	});

	return settings?.timezone || "UTC";
}
