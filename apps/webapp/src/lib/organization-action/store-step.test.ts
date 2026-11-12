import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService, makeDatabaseService } from "@/lib/effect/services/database.service";
import { storeStep } from "./store-step";

class ParkingRefusal extends Error {
	constructor(
		readonly code: "space_taken" | "lot_closed",
		message: string,
		readonly details?: { spaceId?: string },
	) {
		super(message);
	}
}

const db = { name: "db" };
const layer = Layer.succeed(DatabaseService, makeDatabaseService(db as never) as never);
const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) =>
	Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

describe("storeStep", () => {
	it("runs the store with the runtime's database client", async () => {
		const exit = await run(storeStep("parking.list", async (client) => client));

		expect(exit).toEqual(Exit.succeed(db));
	});

	it("turns a coded refusal into a ValidationError carrying its code", async () => {
		const exit = await run(
			storeStep(
				"parking.reserve",
				async () => {
					throw new ParkingRefusal("lot_closed", "The lot is closed");
				},
				{ refusal: ParkingRefusal },
			),
		);

		expect(exit).toEqual(
			Exit.fail(new ValidationError({ message: "The lot is closed", refusal: "lot_closed" })),
		);
	});

	it("carries a refusal's details as the error's value", async () => {
		const exit = await run(
			storeStep(
				"parking.reserve",
				() => {
					throw new ParkingRefusal("space_taken", "Taken", { spaceId: "A1" });
				},
				{ refusal: ParkingRefusal },
			),
		);

		expect(exit).toEqual(
			Exit.fail(
				new ValidationError({ message: "Taken", refusal: "space_taken", value: { spaceId: "A1" } }),
			),
		);
	});

	it("passes a tagged error the store throws through unchanged", async () => {
		for (const error of [
			new ValidationError({ message: "Choose a lot", field: "lotId" }),
			new NotFoundError({ message: "Lot not found", entityType: "lot", entityId: "l1" }),
			new ConflictError({ message: "Already booked", conflictType: "booking" }),
		]) {
			const exit = await run(
				storeStep("parking.reserve", async () => {
					throw error;
				}),
			);

			expect(exit).toEqual(Exit.fail(error));
		}
	});

	it("reports anything else as a DatabaseError, worded by `failure` when given", async () => {
		const cause = new Error("connection reset");
		const plain = await run(
			storeStep("parking.reserve", async () => {
				throw cause;
			}),
		);
		const worded = await run(
			storeStep(
				"parking.reserve",
				async () => {
					throw cause;
				},
				{ failure: "The space could not be reserved" },
			),
		);

		expect(Exit.isFailure(plain) && plain.cause).toBeTruthy();
		expect(plain).toMatchObject(Exit.fail(expect.any(DatabaseError)));
		expect(worded).toEqual(
			Exit.fail(
				new DatabaseError({
					message: "The space could not be reserved",
					operation: "parking.reserve",
					cause,
				}),
			),
		);
	});
});
