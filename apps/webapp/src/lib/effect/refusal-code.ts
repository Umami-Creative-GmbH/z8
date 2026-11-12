/**
 * The stable refusal code of a failed `organizationAction` result, for clients
 * that translate a feature's own codes: the store's refusal (`refusal`), else
 * the code standing in for the module's sign-in or access refusal, else
 * `failed`. Client-safe.
 */
export function refusalCodeOf<Code extends string>(
	failure: { code?: string; refusal?: string },
	accessCodes: { signedOut: Code; noAccess: Code },
): Code | "failed" {
	if (failure.refusal) return failure.refusal as Code;
	if (failure.code === "AuthenticationError") return accessCodes.signedOut;
	if (failure.code === "AuthorizationError") return accessCodes.noAccess;
	return "failed";
}
