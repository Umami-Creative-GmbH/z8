import { Cause, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "./errors";
import { toServerActionResult } from "./result";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("toServerActionResult", () => {
	it("returns the success value", () => {
		expect(toServerActionResult(Exit.succeed({ id: "entry-1" }))).toEqual({
			success: true,
			data: { id: "entry-1" },
		});
	});

	it("logs payroll conflict diagnostics without exposing them to the client", () => {
		const error = new ConflictError({
			message: "Payroll data is temporarily unavailable",
			conflictType: "canonical_payroll_data_not_ready",
			details: {
				organizationId: "org-1",
				reconciliation: {
					workCountMismatch: 2,
					absenceCountMismatch: 1,
					durationMismatchRecords: 3,
				},
			},
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(Exit.fail(error));

		expect(consoleError).toHaveBeenCalledWith("[ServerAction Error]", error);
		expect(result).toEqual({
			success: false,
			error: "Payroll data is temporarily unavailable",
			code: "ConflictError",
		});
		expect(result).not.toHaveProperty("details");
	});

	it("passes a validation value through as the holiday name", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(
			Exit.fail(
				new ValidationError({ message: "Date is a holiday", field: "date", value: "New Year" }),
			),
		);

		expect(result).toEqual({
			success: false,
			error: "Date is a holiday",
			code: "ValidationError",
			holidayName: "New Year",
		});
	});

	it("reports the typed failure, not a finalizer defect, when the cause holds both", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new ValidationError({ message: "End must be after start", field: "end" });

		const result = toServerActionResult(
			Exit.failCause(Cause.combine(Cause.die(new Error("finalizer blew up")), Cause.fail(error))),
		);

		expect(result).toEqual({
			success: false,
			error: "End must be after start",
			code: "ValidationError",
		});
	});

	it("reports an interrupt-only cause with the generic message, not the internal one", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(Exit.failCause(Cause.interrupt()));

		expect(result).toEqual({
			success: false,
			error: "An unexpected error occurred",
			code: "UNKNOWN_ERROR",
		});
	});

	it("reports a defect as an unknown error with its message", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(Exit.die(new Error("connection reset")));

		expect(result).toEqual({
			success: false,
			error: "connection reset",
			code: "UNKNOWN_ERROR",
		});
	});
});
