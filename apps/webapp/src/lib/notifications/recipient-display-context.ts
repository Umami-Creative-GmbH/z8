import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";

export interface RecipientDisplayContext {
	timezone: string;
	locale: string;
	timeFormat: "12h" | "24h";
}

function isValidTimezone(timezone: string): boolean {
	return DateTime.fromMillis(0, { zone: timezone }).isValid;
}

/**
 * Resolves display preferences only after proving the recipient belongs to the
 * notification's organization. This prevents global user preferences leaking
 * across tenants into outbound messages.
 */
export async function resolveRecipientDisplayContext(input: {
	userId: string;
	organizationId: string;
}): Promise<RecipientDisplayContext | null> {
	const recipient = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, input.userId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.isActive, true),
		),
		columns: { id: true },
	});
	if (!recipient) return null;

	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, input.userId),
		columns: { locale: true, timeFormat: true, timezone: true },
	});
	return {
		locale: settings?.locale ?? DEFAULT_LANGUAGE,
		timeFormat: settings?.timeFormat === "12h" ? "12h" : "24h",
		timezone: settings && isValidTimezone(settings.timezone) ? settings.timezone : "UTC",
	};
}
