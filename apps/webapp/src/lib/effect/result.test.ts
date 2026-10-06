import { Exit } from "effect";
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
