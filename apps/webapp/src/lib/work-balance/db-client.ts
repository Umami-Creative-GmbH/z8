import type { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The client every work balance and balance adjustment query runs on: the
 * app's database, a transaction of it, or the client of the caller's
 * `DatabaseService` (docs/refs/effect.md, "Data access functions").
 */
export type WorkBalanceDbClient = Pick<
	Transaction,
	"delete" | "execute" | "insert" | "query" | "select" | "update"
>;

/** A client that also opens transactions: the app's database or the caller's. */
export type WorkBalanceDatabase = WorkBalanceDbClient & Pick<typeof db, "transaction">;
