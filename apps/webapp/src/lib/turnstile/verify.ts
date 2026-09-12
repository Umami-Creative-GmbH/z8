/**
 * Legacy independent Turnstile verification client.
 * Its result does not authorize authentication. Auth forms must send the token
 * with the auth request so the auth before hook verifies it exactly once.
 */

export interface TurnstileVerifyResult {
	success: boolean;
	error?: string;
}

const verificationFailure: TurnstileVerifyResult = {
	success: false,
	error: "Verification failed.",
};

function isTurnstileVerifyResult(
	value: unknown,
): value is TurnstileVerifyResult {
	if (typeof value !== "object" || value === null) return false;

	const result = value as Record<string, unknown>;
	return (
		typeof result.success === "boolean" &&
		(result.error === undefined || typeof result.error === "string")
	);
}

/**
 * Verify a Turnstile token with the server.
 * The server derives organization context from request headers,
 * so no organization info needs to be passed.
 *
 * @param token - The Turnstile token to verify
 * @returns Verification result
 * @deprecated Do not use in auth operation flows; this consumes the single-use token.
 */
export async function verifyTurnstileWithServer(
	token: string,
): Promise<TurnstileVerifyResult> {
	try {
		const response = await fetch("/api/auth/verify-turnstile", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});

		if (!response.ok) {
			const result: unknown = JSON.parse(await response.text());
			if (
				isTurnstileVerifyResult(result) &&
				result.success === false &&
				result.error &&
				!result.error.includes(token)
			) {
				return { success: false, error: result.error };
			}

			return verificationFailure;
		}

		const result: unknown = JSON.parse(await response.text());
		if (!isTurnstileVerifyResult(result)) return verificationFailure;

		if (result.success === false) {
			if (result.error && !result.error.includes(token)) {
				return { success: false, error: result.error };
			}

			return verificationFailure;
		}

		return { success: true };
	} catch {
		return verificationFailure;
	}
}
