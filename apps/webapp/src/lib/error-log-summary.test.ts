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

	it("keeps no message line when the message changed after the stack was taken", () => {
		const failure = new Error(`Failed query\nparams: x\n    at ${REASON}`);
		void failure.stack;
		failure.message = "Failed query";

		expect(JSON.stringify(errorLogSummary(failure))).not.toContain(REASON);
	});

	it("keeps no message line when toString leaves the message out of the header", () => {
		class NamedOnly extends Error {
			override toString() {
				return this.name;
			}
		}
		const failure = new NamedOnly(`Failed query\n    at the hospital with ${REASON}`);

		expect(JSON.stringify(errorLogSummary(failure))).not.toContain(REASON);
	});

	it("keeps no line from an overridden stack that is not a real frame", () => {
		const failure = new Error("Failed query");
		failure.stack = `Error: Failed query\n    at ${REASON}\n    at run (file:///app/x.js:10:5)`;

		const summary = errorLogSummary(failure);

		expect(JSON.stringify(summary)).not.toContain(REASON);
		expect(summary.frames).toEqual(["at run (file:///app/x.js:10:5)"]);
	});

	it("keeps constructor, async, method-alias and anonymous frames", () => {
		const frames = [
			"at new DrizzleQueryError (file:///app/node_modules/drizzle-orm/errors.js:12:5)",
			"at async Promise.all (index 0)",
			"at async run (file:///app/x.js:10:5)",
			"at Object.handler [as reject] (file:///app/route.js:3:9)",
			"at Array.map (<anonymous>)",
			"at file:///app/x.js:1:1",
		];
		const failure = new Error("Failed query");
		failure.stack = ["Error: Failed query", ...frames.map((frame) => `    ${frame}`)].join("\n");

		expect(errorLogSummary(failure).frames).toEqual(
			frames.filter((frame) => frame !== "at async Promise.all (index 0)"),
		);
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
