import { describe, expect, it, vi } from "vitest";
import {
	captureAuthTransactions,
	currentAuthTransaction,
	queueAfterAuthTransactionCommit,
	requireAuthTransaction,
	UncoordinatedAuthMutationError,
} from "./auth-transaction";

function fakeDatabase() {
	const events: string[] = [];
	const transaction = {
		execute: vi.fn(),
		marker: "transaction",
		select() {
			return this.marker;
		},
	};
	const database = {
		marker: "database",
		$client: "pool",
		select() {
			return this.marker;
		},
		transaction: vi.fn(
			async <T>(callback: (tx: typeof transaction) => Promise<T>, _config?: unknown) => {
				try {
					const result = await callback(transaction);
					events.push("commit");
					return result;
				} catch (error) {
					events.push("rollback");
					throw error;
				}
			},
		),
	};
	return { database, transaction, events };
}

describe("captureAuthTransactions", () => {
	it("exposes the drizzle transaction Better Auth opened while its callback runs", async () => {
		const { database, transaction } = fakeDatabase();
		const captured = captureAuthTransactions(database);

		const seen = await captured.transaction(async (tx) => {
			expect(tx).toBe(transaction);
			return currentAuthTransaction();
		});

		expect(seen).toBe(transaction);
		expect(currentAuthTransaction()).toBeNull();
	});

	it("passes transaction configuration through and leaves other members untouched", async () => {
		const { database } = fakeDatabase();
		const captured = captureAuthTransactions(database);
		const config = { isolationLevel: "read committed" };

		await captured.transaction(async () => undefined, config);

		expect(database.transaction).toHaveBeenCalledWith(expect.any(Function), config);
		expect(captured.select()).toBe("database");
		expect(captured.marker).toBe("database");
	});

	// Better Auth's HTTP handler resets its adapter context to the base adapter,
	// whose queries go through this client rather than the transaction's.
	it("runs the client's queries on the transaction while one is active", async () => {
		const { database } = fakeDatabase();
		const captured = captureAuthTransactions(database);

		const inside = await captured.transaction(async () => [captured.select(), captured.$client]);

		expect(inside).toEqual(["transaction", "pool"]);
		expect(captured.select()).toBe("database");
	});

	it("joins a transaction opened while one is active instead of opening another", async () => {
		const { database, transaction } = fakeDatabase();
		const captured = captureAuthTransactions(database);

		const nested = await captured.transaction(() =>
			captured.transaction(async (tx) => [tx, currentAuthTransaction()]),
		);

		expect(nested).toEqual([transaction, transaction]);
		expect(database.transaction).toHaveBeenCalledTimes(1);
	});

	it("stops exposing a transaction once its callback settled, even to work it started", async () => {
		const { database } = fakeDatabase();
		const captured = captureAuthTransactions(database);
		let later: Promise<unknown> = Promise.resolve();
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		await captured.transaction(async () => {
			later = gate.then(() => currentAuthTransaction());
		});
		release();

		await expect(later).resolves.toBeNull();
	});

	it("does not expose the global database outside a transaction", () => {
		expect(currentAuthTransaction()).toBeNull();
	});
});

describe("requireAuthTransaction", () => {
	it("fails closed when a mutation runs outside a coordinated auth transaction", () => {
		expect(() => requireAuthTransaction("organization member role update")).toThrow(
			UncoordinatedAuthMutationError,
		);
	});

	it("returns the captured transaction inside one", async () => {
		const { database, transaction } = fakeDatabase();
		const captured = captureAuthTransactions(database);

		await expect(
			captured.transaction(async () => requireAuthTransaction("organization member removal")),
		).resolves.toBe(transaction);
	});
});

describe("queueAfterAuthTransactionCommit", () => {
	it("runs queued work after the outermost transaction commits, in order", async () => {
		const { database, events } = fakeDatabase();
		const captured = captureAuthTransactions(database);

		await captured.transaction(async () => {
			await queueAfterAuthTransactionCommit(async () => {
				events.push("first");
			});
			await captured.transaction(async () => {
				await queueAfterAuthTransactionCommit(async () => {
					events.push("second");
				});
			});
			events.push("end");
		});

		expect(events).toEqual(["end", "commit", "first", "second"]);
	});

	it("drops queued work when the transaction rolls back", async () => {
		const { database, events } = fakeDatabase();
		const captured = captureAuthTransactions(database);

		await expect(
			captured.transaction(async () => {
				await queueAfterAuthTransactionCommit(async () => {
					events.push("after-commit");
				});
				throw new Error("refused");
			}),
		).rejects.toThrow("refused");

		expect(events).toEqual(["rollback"]);
	});

	it("runs the work at once outside a transaction", async () => {
		const work = vi.fn(async () => undefined);

		await queueAfterAuthTransactionCommit(work);

		expect(work).toHaveBeenCalledOnce();
	});
});
