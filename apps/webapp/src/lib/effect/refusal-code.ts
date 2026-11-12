/**
 * The stable refusal code of a failed `organizationAction` result (#1592), for a
 * client that translates its own codes: the `refusal` a store refused with
 * (`refusalWork`), `refused` when settings access was refused, else `failed`.
 * Client-safe: no server-only imports.
 */
export function refusalCodeOf<Code extends string>(
	result: { code?: string; refusal?: string },
	isCode: (value: string) => value is Code,
	refused: Code,
): Code | "failed" {
	if (result.refusal && isCode(result.refusal)) return result.refusal;
	if (result.code === "AuthorizationError" || result.code === "AuthenticationError") return refused;
	return "failed";
}
