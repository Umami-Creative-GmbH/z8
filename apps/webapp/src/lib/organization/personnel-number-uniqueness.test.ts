/**
 * #881: a save that loses its personnel number to another employee refuses on
 * the personnel number field. The holder lookup after a failed save is a
 * database read like any other, so its own failure stays a typed
 * `DatabaseError`; a serializable save that lost a race (40001) is the refusal
 * only when the number turns out to be held.
 */
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { keepPersonnelNumberRefusal, PersonnelNumberTaken } from "./personnel-number-uniqueness";

vi.mock("@/tolgee/server", async () => ({
	getTranslate: async () =>
		(await import("@/lib/organization/custom-fields/refusal-messages")).englishDefaults,
}));

const uniqueViolation = new DatabaseError({
	message: "Database query failed: save",
	operation: "save",
	cause: Object.assign(new Error("duplicate key"), {
		code: "23505",
		constraint: "employee_organization_personnel_number_unique_idx",
	}),
});
const serializationFailure = new DatabaseError({
	message: "Database query failed: save",
	operation: "save",
	cause: Object.assign(new Error("could not serialize access"), { code: "40001" }),
});

async function failureOf<A, E>(effect: Effect.Effect<A, E>) {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) throw new Error("expected the save to fail");
	return Option.getOrNull(Cause.findErrorOption(exit.cause));
}

const holderNamed = (name: string | null) => () => Effect.succeed(name === null ? null : { name });

describe("keepPersonnelNumberRefusal", () => {
	it("names the holder a check found, without looking it up again", async () => {
		const lookup = vi.fn(holderNamed("Other"));
		const failure = await failureOf(
			Effect.fail(
				new DatabaseError({
					message: "Database query failed: save",
					operation: "save",
					cause: new PersonnelNumberTaken({ name: "Ada Holder" }),
				}),
			).pipe(keepPersonnelNumberRefusal(lookup)),
		);

		expect(failure).toBeInstanceOf(ValidationError);
		expect(failure).toMatchObject({
			field: "employeeNumber",
			refusal: "personnel_number_taken",
			message:
				"This personnel number belongs to Ada Holder. Every employee, current or former, needs their own number.",
		});
		expect(lookup).not.toHaveBeenCalled();
	});

	it("looks up the holder after a unique index violation", async () => {
		const failure = await failureOf(
			Effect.fail(uniqueViolation).pipe(keepPersonnelNumberRefusal(holderNamed("Ada Holder"))),
		);

		expect(failure).toMatchObject({
			refusal: "personnel_number_taken",
			message:
				"This personnel number belongs to Ada Holder. Every employee, current or former, needs their own number.",
		});
	});

	it("keeps a failed holder lookup a typed database error", async () => {
		const lookupFailure = new DatabaseError({
			message: "Database query failed: findPersonnelNumberHolder",
			operation: "findPersonnelNumberHolder",
			cause: new Error("connection reset"),
		});

		const failure = await failureOf(
			Effect.fail(uniqueViolation).pipe(
				keepPersonnelNumberRefusal(() => Effect.fail(lookupFailure)),
			),
		);

		expect(failure).toBe(lookupFailure);
	});

	it("refuses a serialization failure when another holder has the number now", async () => {
		const failure = await failureOf(
			Effect.fail(serializationFailure).pipe(
				keepPersonnelNumberRefusal(holderNamed("Grace Hopper")),
			),
		);

		expect(failure).toMatchObject({
			field: "employeeNumber",
			refusal: "personnel_number_taken",
			message:
				"This personnel number belongs to Grace Hopper. Every employee, current or former, needs their own number.",
		});
	});

	it("keeps a serialization failure when nobody else holds the number", async () => {
		const failure = await failureOf(
			Effect.fail(serializationFailure).pipe(keepPersonnelNumberRefusal(holderNamed(null))),
		);

		expect(failure).toBe(serializationFailure);
	});

	it("passes other failures through", async () => {
		const other = new DatabaseError({ message: "boom", operation: "save", cause: new Error("x") });

		expect(
			await failureOf(Effect.fail(other).pipe(keepPersonnelNumberRefusal(holderNamed("Ada")))),
		).toBe(other);
	});
});
