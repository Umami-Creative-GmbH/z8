/**
 * Settings access levels, safe to import from client components: pages pass the
 * viewer's level (worked out on the server by `resolveCallerSettingsAccess`) and
 * components show or hide controls with `meetsSettingsAccess`.
 */

/**
 * Settings access (Organization glossary, "Organization access"; ADR 0002): the
 * highest of these a user is in one organization. A higher level also
 * qualifies for a lower one. `null` is none.
 */
export type SettingsAccess = "member" | "scopedManager" | "orgAdmin" | "owner";

const RANK: Record<SettingsAccess, number> = {
	member: 0,
	scopedManager: 1,
	orgAdmin: 2,
	owner: 3,
};

/** True when `access` qualifies for a setting that requires `required`. */
export function meetsSettingsAccess(
	access: SettingsAccess | null,
	required: SettingsAccess,
): boolean {
	return access !== null && RANK[access] >= RANK[required];
}
