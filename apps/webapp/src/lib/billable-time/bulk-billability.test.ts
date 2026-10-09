import { describe, expect, it } from "vitest";
import {
	type BulkBillabilityWork,
	bulkBillabilityOutcome,
	parseBulkBillabilityRequest,
	summarizeBulkBillability,
} from "./bulk-billability";

const projectId = "90100000-0000-4000-8000-000000000001";

function work(overrides: Partial<BulkBillabilityWork> = {}): BulkBillabilityWork {
	return {
		id: "90100000-0000-4000-8000-000000000101",
		employeeId: "90100000-0000-4000-8000-000000000201",
		durationMinutes: 60,
		isBillable: false,
		skipReasons: [],
		...overrides,
	};
}

describe("bulkBillabilityOutcome", () => {
	it("changes work that is not in the target state", () => {
		expect(bulkBillabilityOutcome(work({ isBillable: false }), true)).toBe("change");
		expect(bulkBillabilityOutcome(work({ isBillable: true }), false)).toBe("change");
	});

	it("leaves work already in the target state alone", () => {
		expect(bulkBillabilityOutcome(work({ isBillable: true }), true)).toBe("already_in_target");
		expect(bulkBillabilityOutcome(work({ isBillable: false }), false)).toBe("already_in_target");
	});

	it("holds back work with a pending correction or submission", () => {
		expect(bulkBillabilityOutcome(work({ skipReasons: ["held_back"] }), true)).toBe("held_back");
	});

	it("never changes invoiced work, reporting it before held-back work", () => {
		expect(bulkBillabilityOutcome(work({ skipReasons: ["invoiced"] }), true)).toBe("invoiced");
		expect(bulkBillabilityOutcome(work({ skipReasons: ["invoiced", "held_back"] }), true)).toBe(
			"invoiced",
		);
	});

	it("reports work that needs nothing as already in the target state, even when held back", () => {
		expect(
			bulkBillabilityOutcome(work({ isBillable: true, skipReasons: ["held_back"] }), true),
		).toBe("already_in_target");
	});
});

describe("summarizeBulkBillability", () => {
	it("counts work periods and minutes per outcome", () => {
		const summary = summarizeBulkBillability(true, [
			{ durationMinutes: 90, outcome: "change" },
			{ durationMinutes: 30, outcome: "change" },
			{ durationMinutes: 45, outcome: "already_in_target" },
			{ durationMinutes: 120, outcome: "held_back" },
			{ durationMinutes: 15, outcome: "invoiced" },
		]);
		expect(summary).toEqual({
			billable: true,
			change: { count: 2, minutes: 120 },
			alreadyInTarget: { count: 1, minutes: 45 },
			skipped: { invoiced: { count: 1, minutes: 15 }, held_back: { count: 1, minutes: 120 } },
		});
	});

	it("reports every skip reason, also when nothing was skipped", () => {
		expect(summarizeBulkBillability(false, [])).toEqual({
			billable: false,
			change: { count: 0, minutes: 0 },
			alreadyInTarget: { count: 0, minutes: 0 },
			skipped: { invoiced: { count: 0, minutes: 0 }, held_back: { count: 0, minutes: 0 } },
		});
	});
});

describe("parseBulkBillabilityRequest", () => {
	it("reads a project, an inclusive day range and the target billability", () => {
		const parsed = parseBulkBillabilityRequest({
			projectId,
			fromDay: "2026-07-01",
			toDay: "2026-07-31",
			billable: true,
		});
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.request.projectId).toBe(projectId);
		expect(parsed.request.fromDay.toString()).toBe("2026-07-01");
		expect(parsed.request.toDay.toString()).toBe("2026-07-31");
		expect(parsed.request.billable).toBe(true);
	});

	it("accepts a single day", () => {
		expect(
			parseBulkBillabilityRequest({
				projectId,
				fromDay: "2026-07-01",
				toDay: "2026-07-01",
				billable: false,
			}).ok,
		).toBe(true);
	});

	it.each([
		[
			"a missing project",
			{ fromDay: "2026-07-01", toDay: "2026-07-31", billable: true },
			"projectId",
		],
		[
			"a malformed project",
			{ projectId: "x", fromDay: "2026-07-01", toDay: "2026-07-31", billable: true },
			"projectId",
		],
		[
			"an invalid day",
			{ projectId, fromDay: "2026-02-30", toDay: "2026-07-31", billable: true },
			"fromDay",
		],
		[
			"a range that ends before it starts",
			{ projectId, fromDay: "2026-07-31", toDay: "2026-07-01", billable: true },
			"toDay",
		],
		[
			"a non-boolean target",
			{ projectId, fromDay: "2026-07-01", toDay: "2026-07-31", billable: "true" },
			"billable",
		],
	])("refuses %s", (_name, input, field) => {
		const parsed = parseBulkBillabilityRequest(input);
		expect(parsed).toMatchObject({ ok: false, field });
	});
});
