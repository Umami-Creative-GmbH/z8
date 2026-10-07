import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DatabaseError } from "../errors";
import { type DatabaseClient, makeDatabaseService } from "./database.service";

const transaction = { marker: "transaction" } as unknown as DatabaseClient;

describe("makeDatabaseService", () => {
	it("binds the service to the given transaction", () => {
		expect(makeDatabaseService(transaction).db).toBe(transaction);
	});

	it("returns the query result", async () => {
		const service = makeDatabaseService(transaction);

		await expect(
			Effect.runPromise(service.query("timeEntry.create", async () => "row")),
		).resolves.toBe("row");
	});

	it("maps a rejected query to DatabaseError with the name and original cause", async () => {
		const service = makeDatabaseService(transaction);
		const cause = new Error("duplicate key value violates unique constraint");

		const error = await Effect.runPromise(
			Effect.flip(
				service.query("timeEntry.create", async () => {
					throw cause;
				}),
			),
		);
		expect(error).toBeInstanceOf(DatabaseError);
		expect(error).toMatchObject({
			_tag: "DatabaseError",
			message: "Database query failed: timeEntry.create",
			operation: "timeEntry.create",
			cause,
		});
	});
});
