/**
 * The key scopes of the Public API v1 (#763): what an API key may read. The
 * settings picker, the key validation schemas, the stored key and the request
 * pipeline all use this list, so a scope exists everywhere or nowhere.
 *
 * A key stores its scopes as Better Auth key permissions (`{ resource: [action] }`),
 * which only server code can set.
 */
export const API_KEY_SCOPES = [
	"time-entries:read",
	"absences:read",
	"absences:read-health",
	"employees:read",
	"projects:read",
	"customers:read",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Key permissions as Better Auth stores them: resource to actions. */
export type ApiKeyPermissions = Record<string, string[]>;

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
	return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** The stored permissions for a set of scopes. Unknown scopes are dropped. */
export function permissionsOfScopes(scopes: readonly string[]): ApiKeyPermissions {
	const permissions: ApiKeyPermissions = {};
	for (const scope of API_KEY_SCOPES) {
		if (!scopes.includes(scope)) continue;
		const [resource, action] = scope.split(":") as [string, string];
		permissions[resource] = [...(permissions[resource] ?? []), action];
	}
	return permissions;
}

/** The v1 scopes a key's stored permissions grant, in list order. Anything else is ignored. */
export function scopesOfPermissions(permissions: unknown): ApiKeyScope[] {
	if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return [];
	const granted = new Set<string>();
	for (const [resource, actions] of Object.entries(permissions)) {
		if (!Array.isArray(actions)) continue;
		for (const action of actions) granted.add(`${resource}:${String(action)}`);
	}
	return API_KEY_SCOPES.filter((scope) => granted.has(scope));
}
