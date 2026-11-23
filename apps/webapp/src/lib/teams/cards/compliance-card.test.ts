import { describe, expect, it } from "vitest";
import type {
	ComplianceAlert,
	ComplianceExceptionSummary,
} from "@/lib/effect/services/teams-compliance.service";
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

const violation: ComplianceAlert = {
	id: "violation-1",
	type: "rest_period",
	severity: "violation",
	employeeId: "employee-1",
	employeeName: "Avery Employee",
	date: new Date("2026-03-09T08:00:00Z"),
	details: "Rest Period Violation",
	hasException: false,
};

const REVIEW_EXCEPTIONS = {
	type: "Action.OpenUrl",
	title: "Review Exceptions",
	url: "https://app.example.com/approvals/inbox?types=compliance_exception",
};

const VIEW_VIOLATIONS = {
	type: "Action.OpenUrl",
	title: "View Compliance Dashboard",
	url: "https://app.example.com/settings/work-policies?tab=work&view=compliance",
};

function actionsOf(input: {
	alerts?: ComplianceAlert[];
	pendingExceptions?: ComplianceExceptionSummary[];
	canOpenViolationsView: boolean;
}) {
	const alerts = input.alerts ?? [];
	const card = buildComplianceCard({
		summary: {
			...summary,
			alerts,
			recentViolationsCount: alerts.length,
			pendingExceptions: input.pendingExceptions ?? [],
		},
		daysBack: 7,
		appUrl: "https://app.example.com",
		locale: "en",
		canOpenViolationsView: input.canOpenViolationsView,
	});
	return card.actions as Array<{ type: string; title: string; url: string }>;
}

describe("buildComplianceCard", () => {
	// Only org admins open the work-policy compliance view; no other page lists a manager's
	// violations, so a manager's card links none (#1977).
	describe("for an org admin, who can open the violations view", () => {
		const canOpenViolationsView = true;

		it("opens the violations when only violations are listed", () => {
			expect(actionsOf({ alerts: [violation], canOpenViolationsView })).toEqual([VIEW_VIOLATIONS]);
		});

		it("opens pending exceptions in the Approval inbox, never the retired settings queue", () => {
			expect(actionsOf({ pendingExceptions: [pendingException], canOpenViolationsView })).toEqual([
				REVIEW_EXCEPTIONS,
			]);
		});

		it("keeps the violations link beside the exceptions when the card lists both", () => {
			expect(
				actionsOf({
					alerts: [violation],
					pendingExceptions: [pendingException],
					canOpenViolationsView,
				}),
			).toEqual([REVIEW_EXCEPTIONS, VIEW_VIOLATIONS]);
		});
	});

	describe("for a manager, who cannot open the violations view", () => {
		const canOpenViolationsView = false;

		it("links nothing when only violations are listed", () => {
			expect(actionsOf({ alerts: [violation], canOpenViolationsView })).toEqual([]);
		});

		it("opens pending exceptions in the Approval inbox", () => {
			expect(actionsOf({ pendingExceptions: [pendingException], canOpenViolationsView })).toEqual([
				REVIEW_EXCEPTIONS,
			]);
		});

		it("opens only the exceptions when the card lists both", () => {
			expect(
				actionsOf({
					alerts: [violation],
					pendingExceptions: [pendingException],
					canOpenViolationsView,
				}),
			).toEqual([REVIEW_EXCEPTIONS]);
		});
	});
});
