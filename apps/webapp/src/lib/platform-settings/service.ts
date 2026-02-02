import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemConfig } from "@/db/schema";

// Keys for platform settings stored in systemConfig table
const COOKIE_CONSENT_SCRIPT_KEY = "cookie_consent_script";

/**
 * Get the global cookie consent script
 * @returns The script content or null if not configured
 */
export async function getCookieConsentScript(): Promise<string | null> {
	try {
		const config = await db.query.systemConfig.findFirst({
			where: eq(systemConfig.key, COOKIE_CONSENT_SCRIPT_KEY),
		});
		return config?.value ?? null;
	} catch (error) {
		console.warn("Failed to fetch cookie consent script:", error);
		return null;
	}
}

/**
 * Set the global cookie consent script
 * @param script The script content (or empty string to disable)
 */
export async function setCookieConsentScript(script: string): Promise<void> {
	const existing = await db.query.systemConfig.findFirst({
		where: eq(systemConfig.key, COOKIE_CONSENT_SCRIPT_KEY),
	});

	if (existing) {
		await db
			.update(systemConfig)
			.set({
				value: script,
			})
			.where(eq(systemConfig.key, COOKIE_CONSENT_SCRIPT_KEY));
	} else {
		await db.insert(systemConfig).values({
			key: COOKIE_CONSENT_SCRIPT_KEY,
			value: script,
			description: "Cookie consent banner script (loaded on auth pages)",
		});
	}
}

/**
 * Delete the cookie consent script
 */
export async function deleteCookieConsentScript(): Promise<void> {
	await db.delete(systemConfig).where(eq(systemConfig.key, COOKIE_CONSENT_SCRIPT_KEY));
}
