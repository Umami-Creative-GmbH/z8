import { describe, expect, it } from "vitest";
import type { ApprovalInboxTopItems } from "@/lib/approvals/inbox/top-items";
import { pendingApprovalsData } from "./pending-approvals-data";

const top = (warnings: ApprovalInboxTopItems["warnings"]): ApprovalInboxTopItems => ({
	counts: { absence_entry: 2 } as ApprovalInboxTopItems["counts"],
	total: 2,
	coveringCount: 0,
	items: [],
	warnings,
});

const warning = (source: string, failure?: "list" | "count" | "covering") => ({
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
