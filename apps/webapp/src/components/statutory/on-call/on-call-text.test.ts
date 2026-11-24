import { describe, expect, it } from "vitest";
import { onCallWarningText } from "@/components/scheduling/on-call-warning-text";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { StatutoryFindingSummary } from "@/lib/statutory/finding";
import { onCallFindingText } from "./on-call-text";

/** Returns the key, so the test sees which text was chosen. */
const t = ((key: string) => key) as unknown as Parameters<typeof onCallFindingText>[1];

const summary = (tier: StatutoryFindingSummary["tier"]): StatutoryFindingSummary => ({
	tier,
	used: { unit: "minutes", value: 720 },
	limit: { unit: "minutes", value: 750 },
});

describe("on-call weekly band texts (#1992)", () => {
	it("tells a week approaching the band limit from a week above the band", () => {
		const text = (tier: StatutoryFindingSummary["tier"]) =>
			onCallFindingText({ kind: "on_call_weekly_over_band", summary: summary(tier) }, t);

		expect(text("warning")).toBe("common.onCall.finding.nearBand");
		expect(text("critical")).toBe("common.onCall.finding.nearBand");
		expect(text("exceeded")).toBe("common.onCall.finding.overBand");
	});

	it("does the same for planners in Scheduling and Staffing", () => {
		const text = (tier: StatutoryFindingSummary["tier"]) =>
			onCallWarningText(
				{
					statutoryKind: "on_call_weekly_over_band",
					summary: summary(tier),
				} as unknown as StatutoryComplianceFinding,
				t,
			);

		expect(text("critical")).toBe("scheduling:scheduling.statutory.onCall.nearBand");
		expect(text("exceeded")).toBe("scheduling:scheduling.statutory.onCall.overBand");
	});
});
