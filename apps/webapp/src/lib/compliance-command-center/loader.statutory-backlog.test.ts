/**
 * #1994: open statutory findings are a standing backlog, not events. However old they are, they
 * must not crowd real recent events (an audit-evidence failure, a sensitive access-control action)
 * out of "Recent critical events"; the workforce card lists them with a link per domain instead.
 */
import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const violationGroupBy = vi.fn(async () => []);
	const exceptionWhere = vi.fn(async () => [{ count: 0 }]);
	const violationFrom = vi.fn(() => ({ where: vi.fn(() => ({ groupBy: violationGroupBy })) }));
	const exceptionFrom = vi.fn(() => ({ where: exceptionWhere }));
	return {
		select: vi
			.fn()
			.mockImplementationOnce(() => ({ from: violationFrom }))
			.mockImplementationOnce(() => ({ from: exceptionFrom })),
		loadStatutoryReviewInbox: vi.fn(),
	};
});

vi.mock("@/db", () => ({ db: { select: mockState.select } }));

vi.mock("@/lib/statutory/review-inbox", () => ({
	loadStatutoryReviewInbox: mockState.loadStatutoryReviewInbox,
}));

const event = (id: string, sectionKey: "auditEvidence" | "accessControls", occurredAt: string) => ({
	id,
	sectionKey,
	severity: "critical" as const,
	title: { key: `title.${id}` },
	description: { key: `description.${id}` },
	occurredAt,
	primaryLink: { label: { key: "open" }, href: "/settings/audit-export" },
});

vi.mock("./sections/audit-evidence", () => ({
	getAuditEvidenceSection: vi.fn(async () => ({
		card: {
			key: "auditEvidence",
			status: "critical",
			headline: { key: "critical" },
			facts: [],
			updatedAt: "2026-11-20T09:00:00Z",
			primaryLink: { label: { key: "audit" }, href: "/settings/audit-export" },
		},
		recentCriticalEvents: [event("audit-failure", "auditEvidence", "2026-11-20T09:00:00Z")],
	})),
}));

vi.mock("./sections/access-controls", () => ({
	getAccessControlsSection: vi.fn(async () => ({
		card: {
			key: "accessControls",
			status: "critical",
			headline: { key: "critical" },
			facts: [],
			updatedAt: "2026-11-21T14:00:00Z",
			primaryLink: { label: { key: "log" }, href: "/settings/audit-export?tab=activity" },
		},
		recentCriticalEvents: [
			event("role-change", "accessControls", "2026-11-21T14:00:00Z"),
			event("export", "accessControls", "2026-11-19T08:00:00Z"),
		],
	})),
}));

const { getComplianceCommandCenterData } = await import("./loader");

const DOMAINS = [
	"minijob",
	"short_term",
	"working_student",
	"on_call",
	"youth_apprentice",
] as const;

describe("Recent critical events with a statutory backlog", () => {
	it("keeps real events and lists statutory findings only on the workforce card", async () => {
		// Critical findings in every domain: enough to fill all five slots if they were events.
		mockState.loadStatutoryReviewInbox.mockResolvedValue({
			items: [],
			domains: DOMAINS.map((domain) => ({
				domain,
				status: "loaded",
				critical: 2,
				warning: 1,
				pendingAcknowledgements: 1,
				staleAcknowledgements: 0,
			})),
		});

		const data = await getComplianceCommandCenterData("org-1");

		expect(data.recentCriticalEvents.map((recent) => recent.id)).toEqual([
			"role-change",
			"audit-failure",
			"export",
		]);
		const workforce = data.sections.find((section) => section.key === "workforceCompliance");
		expect(workforce?.status).toBe("critical");
		expect(workforce?.links?.map((link) => link.href)).toEqual(
			DOMAINS.map((domain) => `/settings/contracts?tab=reviews&domain=${domain}`),
		);
		expect(workforce?.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryFindings",
			params: { critical: 10, warning: 5 },
		});
	});
});
