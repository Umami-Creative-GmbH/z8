const STORAGE_KEY = "z8-last-organization-id";

/**
 * Save the last selected organization ID to localStorage
 */
export function saveLastOrganization(organizationId: string): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, organizationId);
	} catch {
		// localStorage might be unavailable in some contexts
	}
}

/**
 * Get the last selected organization ID from localStorage
 */
export function getLastOrganization(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

/**
 * Clear the last selected organization ID from localStorage
 */
export function clearLastOrganization(): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// localStorage might be unavailable in some contexts
	}
}
