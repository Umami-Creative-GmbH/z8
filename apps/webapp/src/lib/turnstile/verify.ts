/**
 * Server-side Turnstile token verification utility.
 * Used by auth forms to verify tokens before submission.
 */

export interface TurnstileVerifyResult {
	success: boolean;
	error?: string;
}

/**
 * Verify a Turnstile token with the server.
 * The server derives organization context from request headers,
 * so no organization info needs to be passed.
 *
 * @param token - The Turnstile token to verify
 * @returns Verification result
 */
export async function verifyTurnstileWithServer(token: string): Promise<TurnstileVerifyResult> {
	try {
		const response = await fetch("/api/auth/verify-turnstile", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});

		const result = await response.json();

		if (!result.success) {
			return {
				success: false,
				error: result.error || "Verification failed.",
			};
		}

		return { success: true };
	} catch {
		return {
			success: false,
			error: "Verification failed.",
		};
	}
}
