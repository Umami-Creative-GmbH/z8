import { KIOSK_CACHE_STORE, kioskDatabaseMayExist, kioskTransaction } from "./kiosk-database";
import type {
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeState,
	KioskEmployeesResponse,
} from "./protocol";

/**
 * What an offline-mode kiosk keeps between contacts (#1291, spec #885), so it
 * still opens through an outage, a reload or a restart: the kiosk as the
 * server last described it, and the employees assigned to its location with
 * each one's state and the server instant it was read at. Never a day total,
 * a PIN or anything that can check a PIN (ADR 0011).
 *
 * Each contact decides what stays: a kiosk whose offline mode is off (switched
 * off, or its organization returned to legacy) keeps nothing; a new employee
 * list replaces the old one, so an unassigned employee is gone; a revoked or
 * unpaired kiosk forgets everything. The cache is best effort: storage that
 * fails reads as empty and is never an error.
 */

/** A cached employee: their state as of `learnedAt` (a UTC ISO instant from the server). */
export type CachedKioskEmployee = KioskEmployeeListing & {
	state: KioskEmployeeState;
	learnedAt: string;
};

export type KioskOfflineCache = {
	/** The kiosk as the server last described it; null when nothing is cached. */
	readKiosk(): Promise<KioskDeviceInfo | null>;
	/** The kiosk's cached employees, ordered as listed; null when none are cached for it. */
	readEmployees(kioskId: string): Promise<CachedKioskEmployee[] | null>;
	/** A contact's kiosk: kept with offline mode on, otherwise everything is deleted. */
	rememberKiosk(kiosk: KioskDeviceInfo): Promise<void>;
	/** A contact's employee list: replaces the cached one; without states it is deleted. */
	rememberEmployees(kioskId: string, listed: KioskEmployeesResponse): Promise<void>;
	/** Deletes everything this cache holds (revoked or unpaired kiosk). */
	forget(): Promise<void>;
};

/** Key-value records in the kiosk database's `cache` store. */
export type KioskCacheStorage = {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	delete(keys: readonly string[]): Promise<void>;
};

const KIOSK_KEY = "kiosk";
const EMPLOYEES_KEY = "employees";
const ALL_KEYS = [KIOSK_KEY, EMPLOYEES_KEY] as const;

type CachedEmployees = { kioskId: string; employees: CachedKioskEmployee[] };

export function createKioskOfflineCache(storage: () => KioskCacheStorage): KioskOfflineCache {
	async function attempt<T>(run: (store: KioskCacheStorage) => Promise<T>, fallback: T) {
		try {
			return await run(storage());
		} catch {
			return fallback;
		}
	}

	async function forget() {
		await attempt((store) => store.delete(ALL_KEYS), undefined);
	}

	return {
		readKiosk: () =>
			attempt(async (store) => (await store.get<KioskDeviceInfo>(KIOSK_KEY)) ?? null, null),

		readEmployees: (kioskId) =>
			attempt(async (store) => {
				const cached = await store.get<CachedEmployees>(EMPLOYEES_KEY);
				return cached?.kioskId === kioskId ? cached.employees : null;
			}, null),

		async rememberKiosk(kiosk) {
			if (!kiosk.offlineMode) return forget();
			await attempt(async (store) => {
				const cached = await store.get<KioskDeviceInfo>(KIOSK_KEY);
				if (cached && cached.id !== kiosk.id) await store.delete([EMPLOYEES_KEY]);
				await store.put(KIOSK_KEY, kiosk);
			}, undefined);
		},

		async rememberEmployees(kioskId, listed) {
			const offline = listed.offline;
			await attempt(async (store) => {
				if (!offline) return store.delete([EMPLOYEES_KEY]);
				const employees = listed.employees.flatMap((employee): CachedKioskEmployee[] => {
					const state = offline.states[employee.id];
					return state
						? [{ id: employee.id, name: employee.name, state, learnedAt: offline.learnedAt }]
						: [];
				});
				await store.put(EMPLOYEES_KEY, { kioskId, employees } satisfies CachedEmployees);
			}, undefined);
		},

		forget,
	};
}

/** The `cache` store of the kiosk's IndexedDB. */
export function indexedDbKioskCacheStorage(): KioskCacheStorage {
	if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
	return {
		async get<T>(key: string) {
			// Reading must not create the database either.
			if (!(await kioskDatabaseMayExist())) return undefined;
			return kioskTransaction<T>(
				KIOSK_CACHE_STORE,
				"readonly",
				(transaction) => transaction.objectStore(KIOSK_CACHE_STORE).get(key) as IDBRequest<T>,
			);
		},
		async put(key, value) {
			await kioskTransaction(KIOSK_CACHE_STORE, "readwrite", (transaction) =>
				transaction.objectStore(KIOSK_CACHE_STORE).put(value, key),
			);
		},
		async delete(keys) {
			// A kiosk that never had offline mode has no database; deleting must not create one.
			if (!(await kioskDatabaseMayExist())) return;
			await kioskTransaction(KIOSK_CACHE_STORE, "readwrite", (transaction) => {
				const store = transaction.objectStore(KIOSK_CACHE_STORE);
				for (const key of keys) store.delete(key);
				return undefined;
			});
		},
	};
}

/** The kiosk page's cache, in the kiosk's IndexedDB. */
export const kioskOfflineCache: KioskOfflineCache = createKioskOfflineCache(
	indexedDbKioskCacheStorage,
);
