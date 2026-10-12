/**
 * A person's name as the balance adjustment screens show it (#993, #995,
 * #999): their first and last name, else their account name, else `fallback`
 * (such as the employee number, or empty for a deleted user).
 */
export function adjustmentDisplayName(
	parts: { firstName?: string | null; lastName?: string | null; name?: string | null } | null,
	fallback = "",
): string {
	if (!parts) return fallback;
	const structured = [parts.firstName, parts.lastName].filter(Boolean).join(" ").trim();
	return structured || parts.name?.trim() || fallback;
}
