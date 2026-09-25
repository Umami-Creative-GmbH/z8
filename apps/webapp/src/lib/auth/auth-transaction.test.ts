import { describe, expect, it, vi } from "vitest";
import {
	captureAuthTransactions,
	currentAuthTransaction,
	requireAuthTransaction,
	UncoordinatedAuthMutationError,
} from "./auth-transaction";

function fakeDatabase() {
	const transaction = { execute: vi.fn(), marker: "transaction" };
	const database = {
		marker: "database",
		select() {
			return this.marker;
		},
		transaction: vi.fn(
			async <T>(callback: (tx: typeof transaction) => Promise<T>, _config?: unknown) =>
				callback(transaction),
		),
	};
	return { database, transaction };
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
