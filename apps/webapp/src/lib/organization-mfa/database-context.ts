import { AsyncLocalStorage } from "node:async_hooks";
import type { db } from "@/db";
import type { AuthTransaction } from "@/lib/auth/auth-transaction";

type MfaDatabase = typeof db | AuthTransaction;
const databases = new AsyncLocalStorage<MfaDatabase>();

/** Carries the caller's database through Better Auth's callback boundary. */
export function withMfaDatabase<T>(
	database: MfaDatabase,
	work: () => Promise<T>,
): Promise<T> {
	return databases.run(database, work);
}
export const currentMfaDatabase = () => databases.getStore();
