import type { DepartureTaskClaim } from "./outbox";

/**
 * Clears secondary-storage copies of exactly the sessions the departure
 * removed from the database. Retries act on that snapshot only, so sessions
 * created after a rehire are never touched.
 */
export function createSessionRevocationHandler(
	deleteSecondarySession: (token: string) => Promise<void>,
) {
	return async (claim: DepartureTaskClaim) => {
		const tokens = claim.payload.tokens;
		if (!Array.isArray(tokens) || !tokens.every((token) => typeof token === "string")) {
			throw new Error("invalid_session_revocation_payload");
		}
		for (const token of tokens) {
			await deleteSecondarySession(token);
		}
	};
}
