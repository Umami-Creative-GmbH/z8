import type { KioskCacheStorage } from "./offline-cache";

/** An in-memory stand-in for the kiosk's IndexedDB cache store, for unit tests. */
export function memoryKioskCacheStorage(): KioskCacheStorage & { keys(): string[] } {
	const records = new Map<string, unknown>();
	return {
		async get<T>(key: string) {
			return structuredClone(records.get(key)) as T | undefined;
		},
		async put(key: string, value: unknown) {
			records.set(key, structuredClone(value));
		},
		async delete(keys: readonly string[]) {
			for (const key of keys) records.delete(key);
		},
		keys: () => [...records.keys()],
	};
}
