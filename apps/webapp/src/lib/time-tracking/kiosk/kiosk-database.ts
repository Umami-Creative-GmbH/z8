/**
 * The kiosk device's own IndexedDB (#1291, spec #885). It is not the app's
 * `z8-offline-queue`, which belongs to the root service worker and its offline
 * clock queue; opening that one at another version would close its readers.
 *
 * Version 1 has one store, `cache`: what an offline-mode kiosk learned at its
 * last contact (`offline-cache.ts`). Version 2 (#1292) adds `commands`: the
 * queued frozen kiosk commands (`offline-queue.ts`), keyed by an increasing
 * `sequence`. Later slices add their stores by raising `KIOSK_DATABASE_VERSION`
 * and adding one `oldVersion < n` step to `upgradeKioskDatabase`; clearing the
 * cache never touches them.
 */
export const KIOSK_DATABASE_NAME = "z8-kiosk";
export const KIOSK_DATABASE_VERSION = 2;
export const KIOSK_CACHE_STORE = "cache";
export const KIOSK_COMMANDS_STORE = "commands";

export function upgradeKioskDatabase(database: IDBDatabase, oldVersion: number): void {
	if (oldVersion < 1) database.createObjectStore(KIOSK_CACHE_STORE);
	if (oldVersion < 2) {
		database.createObjectStore(KIOSK_COMMANDS_STORE, { keyPath: "sequence", autoIncrement: true });
	}
}

/** False only when the browser can list its databases and the kiosk's is not among them. */
export async function kioskDatabaseMayExist(): Promise<boolean> {
	if (typeof indexedDB.databases !== "function") return true;
	const databases = await indexedDB.databases().catch(() => null);
	return databases?.some((database) => database.name === KIOSK_DATABASE_NAME) ?? true;
}

export function openKioskDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(KIOSK_DATABASE_NAME, KIOSK_DATABASE_VERSION);
		request.onupgradeneeded = (event) => upgradeKioskDatabase(request.result, event.oldVersion);
		request.onsuccess = () => {
			const database = request.result;
			// A newer page version upgrading the database must not be blocked by this one.
			database.onversionchange = () => database.close();
			resolve(database);
		};
		request.onerror = () => reject(request.error);
	});
}

/** Runs one transaction on the kiosk database; writes are durable before they resolve. */
export async function kioskTransaction<T>(
	storeNames: string | string[],
	mode: IDBTransactionMode,
	run: (transaction: IDBTransaction) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
	const database = await openKioskDatabase();
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const transaction = database.transaction(
				storeNames,
				mode,
				mode === "readwrite" ? { durability: "strict" } : undefined,
			);
			const request = run(transaction);
			transaction.oncomplete = () => resolve(request?.result);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
		});
	} finally {
		database.close();
	}
}
