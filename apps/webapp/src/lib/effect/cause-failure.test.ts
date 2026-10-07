import { Cause } from "effect";
import { describe, expect, it } from "vitest";
import { failureOfCause, typedFailureOfCause } from "./cause-failure";
import { ValidationError } from "./errors";

describe("failureOfCause", () => {
	it("returns the typed failure of a failed cause", () => {
		const error = new ValidationError({ message: "Invalid date", field: "date" });

		expect(failureOfCause(Cause.fail(error))).toBe(error);
	});

	it("returns the defect of a died cause", () => {
		const defect = new Error("connection reset");

		expect(failureOfCause(Cause.die(defect))).toBe(defect);
	});

	it("prefers the typed failure when the cause also holds a defect", () => {
		const error = new ValidationError({ message: "Invalid date", field: "date" });
		const finalizerDefect = new Error("finalizer blew up");

		expect(failureOfCause(Cause.combine(Cause.die(finalizerDefect), Cause.fail(error)))).toBe(
			error,
		);
	});

	it("falls back to the squashed cause when it was only interrupted", () => {
		const failure = failureOfCause(Cause.interrupt());

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe("All fibers interrupted without error");
	});
});

describe("typedFailureOfCause", () => {
	it("returns the typed failure even when the cause also holds a defect", () => {
		const error = new ValidationError({ message: "Invalid date", field: "date" });

		expect(
			typedFailureOfCause(Cause.combine(Cause.die(new Error("finalizer")), Cause.fail(error))),
		).toBe(error);
	});

	it("returns undefined for a defect so it is never exposed as a typed error", () => {
		expect(typedFailureOfCause(Cause.die(new Error("connection reset")))).toBeUndefined();
	});
});
