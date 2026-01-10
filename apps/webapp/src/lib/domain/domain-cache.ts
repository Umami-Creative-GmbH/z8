import type { DomainAuthContext } from "./types";

/**
 * Simple in-memory cache for domain configurations
 * In production, consider using Redis for distributed caching
 */
class DomainCache {
	private cache: Map<string, { data: DomainAuthContext; expiresAt: number }> = new Map();
	private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

	/**
	 * Get cached domain config
	 */
	get(domain: string): DomainAuthContext | null {
		const entry = this.cache.get(domain.toLowerCase());
		if (!entry) {
			return null;
		}

		// Check if expired
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(domain.toLowerCase());
			return null;
		}

		return entry.data;
	}

	/**
	 * Set domain config in cache
	 */
	set(domain: string, config: DomainAuthContext): void {
		this.cache.set(domain.toLowerCase(), {
			data: config,
			expiresAt: Date.now() + this.TTL_MS,
		});
	}

	/**
	 * Invalidate cache for a specific domain
	 */
	invalidate(domain: string): void {
		this.cache.delete(domain.toLowerCase());
	}

	/**
	 * Invalidate all cache entries for an organization
	 */
	invalidateOrganization(organizationId: string): void {
		for (const [domain, entry] of this.cache.entries()) {
			if (entry.data.organizationId === organizationId) {
				this.cache.delete(domain);
			}
		}
	}

	/**
	 * Clear all cache entries
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics (for debugging)
	 */
	getStats(): { size: number; domains: string[] } {
		return {
			size: this.cache.size,
			domains: Array.from(this.cache.keys()),
		};
	}
}

// Export singleton instance
export const domainCache = new DomainCache();
