import { describe, expect, it } from "vitest";
import { searchPendingReportRequest } from "./travel-expense-report-pending-search";

/** Scripted reads: each call returns the next scripted answer. */
function reads(script: { locked: string[][]; submitted: boolean[]; anyPending: boolean[] }) {
	const calls = { lockPending: 0, isSubmitted: 0, anyPending: 0 };
	return {
		calls,
		reads: {
			lockPending: async () => script.locked[calls.lockPending++] ?? [],
			isSubmitted: async () => script.submitted[calls.isSubmitted++] ?? false,
			anyPending: async () => script.anyPending[calls.anyPending++] ?? false,
		},
	};
}

describe("searchPendingReportRequest (#603 withdrawal)", () => {
	it("locks the pending request it finds", async () => {
		const { reads: io } = reads({ locked: [["r1"]], submitted: [], anyPending: [] });
		expect(await searchPendingReportRequest(io)).toEqual({ kind: "locked", pending: ["r1"] });
	});

	it("follows a request replaced by a concurrent chain decision", async () => {
		const { reads: io, calls } = reads({
			locked: [[], ["r2"]],
			submitted: [true],
			anyPending: [true],
		});
		expect(await searchPendingReportRequest(io)).toEqual({ kind: "locked", pending: ["r2"] });
		expect(calls.lockPending).toBe(2);
	});

	it("reports a report decided meanwhile as settled", async () => {
		const { reads: io } = reads({ locked: [[]], submitted: [false], anyPending: [] });
		expect(await searchPendingReportRequest(io)).toEqual({ kind: "settled" });
	});

	it("gives up cleanly while concurrent decisions keep replacing the request", async () => {
		const { reads: io, calls } = reads({
			locked: [[], [], []],
			submitted: [true, true, true],
			anyPending: [true, true, true],
		});
		expect(await searchPendingReportRequest(io)).toEqual({ kind: "moving" });
		expect(calls.lockPending).toBe(3);
	});

	it("names a submitted report without any pending request inconsistent at once", async () => {
		const { reads: io, calls } = reads({
			locked: [[]],
			submitted: [true],
			anyPending: [false],
		});
		expect(await searchPendingReportRequest(io)).toEqual({ kind: "missing" });
		expect(calls.lockPending).toBe(1);
	});
});
