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

	it("never takes a message line that is shaped exactly like a real frame", () => {
		// Only the message check stops this one: the line is a well-formed V8 frame.
		const failure = new Error(
			"Failed query\n    at notes (file:///Caring-for-my-sick-child.js:1:2)",
		);

		expect(JSON.stringify(errorLogSummary(failure))).not.toContain("Caring-for-my-sick-child");
	});

	it("keeps no message line when the message changed after the stack was taken", () => {
		const failure = new Error(`Failed query\nparams: x\n    at ${REASON}`);
		void failure.stack;
		failure.message = "Failed query";

		expect(JSON.stringify(errorLogSummary(failure))).not.toContain(REASON);
	});

	it.each(["at 08:30:00", "at clinic:10:30"])(
		"keeps no time-like message line (%s) once the message changed",
		(line) => {
			const failure = new Error(`Failed query\nparams: org-1,Doctor\n${line}`);
			void failure.stack;
			failure.message = "Failed query";

			expect(errorLogSummary(failure).frames).not.toContain(line);
		},
	);

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
			"at get g (file:///app/f.mjs:3:65)",
			"at Object.set value [as value] (file:///app/f.mjs:4:1)",
			"at processTicksAndRejections (node:internal/process/task_queues:95:5)",
			"at inner (eval at <anonymous> (file:///app/f.mjs:6:7), <anonymous>:1:26)",
			"at eval (eval at run (file:///app/f.mjs:6:7), <anonymous>:1:1)",
		];
		const failure = new Error("Failed query");
		failure.stack = ["Error: Failed query", ...frames.map((frame) => `    ${frame}`)].join("\n");

		expect(errorLogSummary(failure).frames).toEqual(
			frames.filter((frame) => frame !== "at async Promise.all (index 0)"),
		);
	});

	it("keeps the frame of a real getter that threw, as V8 writes it", () => {
		const holder = {
			get broken(): never {
				throw new TypeError("broken");
			},
		};
		let failure: unknown;
		try {
			void holder.broken;
		} catch (error) {
			failure = error;
		}

		// Node writes `at get broken (…)`; once transformed (vitest) it is `at Object.get broken [as broken] (…)`.
		expect(errorLogSummary(failure).frames?.[0]).toMatch(/^at (?:Object\.)?get broken /);
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
