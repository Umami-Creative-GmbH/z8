import "server-only";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { type employee, userSettings } from "@/db/schema";
import {
	getRequestSession,
	type RequestSession,
} from "@/lib/auth/request-session";
import { resolveEmployeeContext } from "./employee-context";
import { DEFAULT_TIMEZONE } from "./shared";

export type AuthSession = NonNullable<RequestSession>;
export type CurrentEmployee = typeof employee.$inferSelect;

export async function getCurrentSession(): Promise<AuthSession | null> {
	const session = await getRequestSession();
	return session ?? null;
}

export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return null;
	}

	return (await resolveEmployeeContext(session))?.employee ?? null;
}

export async function getUserTimezone(userId: string): Promise<string> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { timezone: true },
	});

	return settings?.timezone || DEFAULT_TIMEZONE;
}

export async function getRequestMetadata(): Promise<{
	ipAddress: string;
	userAgent: string;
}> {
	const requestHeaders = await headers();

	return {
		ipAddress:
			requestHeaders.get("x-forwarded-for") ||
			requestHeaders.get("x-real-ip") ||
			"unknown",
		userAgent: requestHeaders.get("user-agent") || "unknown",
	};
}
