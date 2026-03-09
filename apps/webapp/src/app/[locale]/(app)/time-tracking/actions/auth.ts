"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DEFAULT_TIMEZONE } from "./shared";

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
export type AuthSession = NonNullable<SessionResult>;
export type CurrentEmployee = typeof employee.$inferSelect;

export async function getCurrentSession(): Promise<AuthSession | null> {
	const session = await auth.api.getSession({ headers: await headers() });
	return session ?? null;
}

async function getEmployeeForUser(
	userId: string,
	activeOrganizationId?: string | null,
): Promise<CurrentEmployee | null> {
	if (activeOrganizationId) {
		const employeeForActiveOrg = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, userId),
				eq(employee.organizationId, activeOrganizationId),
				eq(employee.isActive, true),
			),
		});

		if (employeeForActiveOrg) {
			return employeeForActiveOrg;
		}
	}

	const fallbackEmployee = await db.query.employee.findFirst({
		where: and(eq(employee.userId, userId), eq(employee.isActive, true)),
	});

	return fallbackEmployee ?? null;
}

export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return null;
	}

	return getEmployeeForUser(session.user.id, session.session?.activeOrganizationId);
}

export async function getUserTimezone(userId: string): Promise<string> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { timezone: true },
	});

	return settings?.timezone || DEFAULT_TIMEZONE;
}

export async function getRequestMetadata(): Promise<{ ipAddress: string; userAgent: string }> {
	const requestHeaders = await headers();

	return {
		ipAddress:
			requestHeaders.get("x-forwarded-for") || requestHeaders.get("x-real-ip") || "unknown",
		userAgent: requestHeaders.get("user-agent") || "unknown",
	};
}
