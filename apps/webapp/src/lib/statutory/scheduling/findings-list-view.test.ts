import { describe, expect, it } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { scheduleStatutoryFindingsFor } from "./findings-list-view";

/** A database whose names query finds nobody: every item is unnamed. */
const noNames = {
	select: () => ({
		from: () => ({ innerJoin: () => ({ where: async () => [] }) }),
	}),
} as unknown as Parameters<typeof scheduleStatutoryFindingsFor>[0];

const youthFinding = (employeeId: string, shiftId: string): StatutoryComplianceFinding => ({
	type: "statutory",
	employeeId,
	findingId: `jarbschg_daily_max:${employeeId}:shift:${shiftId}`,
	statutoryKind: "jarbschg_daily_max",
	domain: "youth_protection",
	severity: "critical",
	subjectKey: `shift:${shiftId}`,
	legalReference: "§ 8 Abs. 1 JArbSchG",
	summary: { tier: "exceeded" },
	day: "2027-03-02",
	acknowledgementStatus: null,
	blocksPublication: true,
});

describe("scheduleStatutoryFindingsFor (#2026)", () => {
	it("lists what blocks this publication before a finding of the same severity that only could", async () => {
		// Both can block publishing; only the draft's breach refuses publishing this range.
		const publishedShiftBreach = youthFinding("a-employee", "published");
		const draftBreach = youthFinding("b-employee", "draft");

		const list = await scheduleStatutoryFindingsFor(noNames, {
			organizationId: "org-1",
			viewer: {
				scope: { organizationWide: true, employeeIds: new Set(), teamIds: new Set() },
				audience: "full",
			},
			findings: [
				{ finding: publishedShiftBreach, period: null },
				{ finding: draftBreach, period: null },
			],
			blockingThisPublication: [draftBreach],
		});

		expect(list.items.map((item) => [item.finding.subjectKey, item.blocksThisPublication])).toEqual(
			[
				["shift:draft", true],
				["shift:published", false],
			],
		);
	});
});
