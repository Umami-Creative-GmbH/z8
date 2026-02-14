/**
 * Calendar Token Store
 *
 * Manages calendar OAuth tokens in HashiCorp Vault.
 * Tokens are stored at: secret/data/organizations/{orgId}/calendar/{connectionId}/{key}
 *
 * Falls back to reading from DB columns for pre-migration connections.
 */

import { createLogger } from "@/lib/logger";
import { deleteOrgSecret, getOrgSecret, storeOrgSecret } from "@/lib/vault";

const logger = createLogger("CalendarTokenStore");

function vaultKey(connectionId: string, tokenType: "access_token" | "refresh_token"): string {
	return `calendar/${connectionId}/${tokenType}`;
}

/**
 * Store calendar OAuth tokens in Vault
 */
export async function storeCalendarTokens(
	organizationId: string,
	connectionId: string,
	tokens: { accessToken: string; refreshToken?: string | null },
): Promise<void> {
	await storeOrgSecret(organizationId, vaultKey(connectionId, "access_token"), tokens.accessToken);
	if (tokens.refreshToken) {
		await storeOrgSecret(
			organizationId,
			vaultKey(connectionId, "refresh_token"),
			tokens.refreshToken,
		);
	}
}

/**
 * Retrieve calendar OAuth tokens from Vault, with DB fallback for unmigrated connections.
 */
export async function getCalendarTokens(
	organizationId: string,
	connectionId: string,
	dbAccessToken: string,
	dbRefreshToken: string | null,
): Promise<{ accessToken: string; refreshToken: string | null }> {
	let accessToken = await getOrgSecret(organizationId, vaultKey(connectionId, "access_token"));
	let refreshToken = await getOrgSecret(organizationId, vaultKey(connectionId, "refresh_token"));

	// Fallback: read from DB columns for pre-migration connections
	if (!accessToken && dbAccessToken && dbAccessToken !== "vault:managed") {
		accessToken = dbAccessToken;
		refreshToken = dbRefreshToken;
		logger.warn(
			{ organizationId, connectionId },
			"Calendar tokens read from DB column — run migration to move to Vault",
		);
	}

	if (!accessToken) {
		logger.error(
			{ organizationId, connectionId },
			"Calendar access token not found in Vault or DB",
		);
		return { accessToken: "", refreshToken: null };
	}

	return { accessToken, refreshToken };
}

/**
 * Delete calendar OAuth tokens from Vault
 */
export async function deleteCalendarTokens(
	organizationId: string,
	connectionId: string,
): Promise<void> {
	await Promise.all([
		deleteOrgSecret(organizationId, vaultKey(connectionId, "access_token")),
		deleteOrgSecret(organizationId, vaultKey(connectionId, "refresh_token")),
	]);
}
