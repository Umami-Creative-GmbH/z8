import { describe, expect, it } from "vitest";
import { databaseFailure } from "@/test/log-redaction";
import { errorLogSummary } from "./error-log-summary";

const REASON = "Caring for my sick child";

describe("errorLogSummary (#1975)", () => {
	it("keeps a non-query failure's stack frames, so a 500 can still be located", () => {
		const failure = new TypeError(`cannot read properties of undefined: ${REASON}`);

		const summary = errorLogSummary(failure);

		expect(summary.name).toBe("TypeError");
		expect(summary.frames?.length).toBeGreaterThan(0);
		expect(summary.frames?.every((frame) => frame.startsWith("at "))).toBe(true);
		// The message (the header line of the stack) never comes along.
		expect(JSON.stringify(summary)).not.toContain(REASON);
	});

	it("never takes a frame-shaped line out of the message itself", () => {
		const failure = new Error(`Failed query\nparams: ${REASON}\n    at ${REASON}`);

		expect(JSON.stringify(errorLogSummary(failure))).not.toContain(REASON);
	});

	it("keeps a database failure's code, operation and the constraint, table and column it hit", () => {
		const failure = databaseFailure("compliance_exception.insert", ["org-1", REASON]);
		const postgres = (failure.cause as { cause: Record<string, unknown> }).cause;
		Object.assign(postgres, {
			code: "23505",
			constraint: "compliance_exception_pending_unique",
			table: "compliance_exception",
			column: "reason",
		});

		const summary = errorLogSummary(failure);

		expect(summary).toMatchObject({
			name: "DatabaseError",
			operation: "compliance_exception.insert",
			constraint: "compliance_exception_pending_unique",
			table: "compliance_exception",
			column: "reason",
		});
		expect(JSON.stringify(summary)).not.toContain(REASON);
	});
});
