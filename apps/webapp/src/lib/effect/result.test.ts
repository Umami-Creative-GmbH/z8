import { Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "./errors";
import { toServerActionResult } from "./result";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("toServerActionResult", () => {
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
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = toServerActionResult(Exit.fail(error));

		expect(consoleError).toHaveBeenCalledWith("[ServerAction Error]", error);
		expect(result).toEqual({
			success: false,
			error: "Payroll data is temporarily unavailable",
			code: "ConflictError",
		});
		expect(result).not.toHaveProperty("details");
	});
});
