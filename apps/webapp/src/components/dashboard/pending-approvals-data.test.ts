import { describe, expect, it } from "vitest";
import type { ApprovalInboxTopItems } from "@/lib/approvals/inbox/top-items";
import type { ApprovalInboxSourceFailure } from "@/lib/approvals/inbox/types";
import { pendingApprovalsData } from "./pending-approvals-data";

const top = (warnings: ApprovalInboxTopItems["warnings"]): ApprovalInboxTopItems => ({
	counts: { absence_entry: 2 } as ApprovalInboxTopItems["counts"],
	total: 2,
	coveringCount: 0,
	listed: { absence_entry: 2 },
	items: [],
	warnings,
});

const warning = (source: string, failure?: ApprovalInboxSourceFailure) => ({
	source,
	message: `${source} failed`,
	...(failure ? { failure } : {}),
});

describe("the Dashboard's pending approvals (#1978)", () => {
	it("tells types that could not be counted from types that could not be loaded", () => {
		const data = pendingApprovalsData(
			top([
				warning("travel_expense_report", "count"),
				warning("time_entry", "list"),
				warning("absence_entry", "covering"),
			]),
		);

		// A count failure still lists its rows; a list or Covering failure misses them.
		expect(data.notCountedTypes).toEqual(["travel_expense_report"]);
		expect(data.notLoadedTypes).toEqual(["absence_entry", "time_entry"]);
	});

	it("leaves out a type whose only failure is a Covering section's header count", () => {
		// That count is no part of the badge, the totals or the preview: every row loaded.
		const data = pendingApprovalsData(top([warning("absence_entry", "covering_count")]));

		expect(data).toMatchObject({
			total: 2,
			typeCounts: [{ type: "absence_entry", count: 2 }],
			notLoadedTypes: [],
			notCountedTypes: [],
		});
	});

	it("counts a type whose own count failed at least by its rows in hand, marked as a lower bound", () => {
		// The absence count failed: only the two covered absences were counted, but thirty own
		// absences and the two covered ones were listed.
		const data = pendingApprovalsData({
			counts: { absence_entry: 2, travel_expense_report: 3 } as ApprovalInboxTopItems["counts"],
			total: 5,
			coveringCount: 2,
			listed: { absence_entry: 32, travel_expense_report: 3 },
			items: [],
			warnings: [warning("absence_entry", "count")],
		});

		expect(data.typeCounts).toEqual([
			{ type: "absence_entry", count: 32, atLeast: true },
			{ type: "travel_expense_report", count: 3 },
		]);
		// The total never states fewer than its types do.
		expect(data.total).toBe(35);
		expect(data.notCountedTypes).toEqual(["absence_entry"]);
	});

	it("reports a failure of unknown kind as not loaded, the safe reading", () => {
		const data = pendingApprovalsData(top([warning("travel_expense_claim")]));

		expect(data.notLoadedTypes).toEqual(["travel_expense_claim"]);
		expect(data.notCountedTypes).toEqual([]);
	});

	it("reports nothing when every type loaded and counted", () => {
		const data = pendingApprovalsData(top([]));

		expect(data).toMatchObject({
			total: 2,
			typeCounts: [{ type: "absence_entry", count: 2 }],
			notLoadedTypes: [],
			notCountedTypes: [],
		});
	});
});
