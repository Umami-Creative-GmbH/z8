import { describe, expect, it } from "vitest";
import type { ComplianceExceptionSummary } from "@/lib/effect/services/teams-compliance.service";
import { buildComplianceCard } from "./compliance-card";

const summary = {
	alerts: [],
	pendingExceptions: [],
	recentViolationsCount: 0,
	criticalAlertsCount: 0,
};

const pendingException: ComplianceExceptionSummary = {
	id: "exception-1",
	employeeId: "employee-1",
	employeeName: "Avery Employee",
	exceptionType: "overtime_daily",
	status: "pending",
	requestedAt: new Date("2026-03-10T08:00:00Z"),
	validFrom: new Date("2026-03-10T08:00:00Z"),
	validUntil: new Date("2026-03-11T08:00:00Z"),
	reason: "Inventory count runs late",
};

function actionsOf(input: { pendingExceptions: ComplianceExceptionSummary[] }) {
	const card = buildComplianceCard({
		summary: { ...summary, pendingExceptions: input.pendingExceptions },
		daysBack: 7,
		appUrl: "https://app.example.com",
		locale: "en",
	});
	return card.actions as Array<{ type: string; title: string; url: string }>;
}

describe("buildComplianceCard", () => {
	it("opens pending compliance exceptions in the Approval inbox, never the retired settings queue (#1977)", () => {
		expect(actionsOf({ pendingExceptions: [pendingException] })).toEqual([
			{
				type: "Action.OpenUrl",
				title: "Review Exceptions",
				url: "https://app.example.com/approvals/inbox?types=compliance_exception",
			},
		]);
	});

	it("opens the violations instead when no exception is pending (#1977)", () => {
		expect(actionsOf({ pendingExceptions: [] })).toEqual([
			{
				type: "Action.OpenUrl",
				title: "View Compliance Dashboard",
				url: "https://app.example.com/settings/work-policies?tab=work&view=compliance",
			},
		]);
	});
});
