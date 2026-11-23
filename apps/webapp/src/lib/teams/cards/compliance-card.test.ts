import { describe, expect, it } from "vitest";
import { buildComplianceCard } from "./compliance-card";

const summary = {
	alerts: [],
	pendingExceptions: [],
	recentViolationsCount: 0,
	criticalAlertsCount: 0,
};

describe("buildComplianceCard", () => {
	it("opens compliance exceptions in the Approval inbox, never the retired settings queue (#1977)", () => {
		const card = buildComplianceCard({
			summary,
			daysBack: 7,
			appUrl: "https://app.example.com",
			locale: "en",
		});

		const actions = card.actions as Array<{ type: string; title: string; url: string }>;
		expect(actions).toEqual([
			{
				type: "Action.OpenUrl",
				title: "Review Exceptions",
				url: "https://app.example.com/approvals/inbox?types=compliance_exception",
			},
		]);
	});
});
