import { describe, expect, it, vi } from "vitest";

vi.mock("./sections/audit-evidence", () => ({
	getAuditEvidenceSection: vi.fn(async () => ({
		card: {
			key: "auditEvidence",
			status: "healthy",
			headline: "ok",
			facts: [],
			updatedAt: "2026-04-11T10:00:00.000Z",
			primaryLink: { label: "Audit", href: "/settings/audit-export" },
		},
		recentCriticalEvents: [],
	})),
}));

vi.mock("./sections/workforce-compliance", () => ({
	getWorkforceComplianceSection: vi.fn(async () => ({
		card: {
			key: "workforceCompliance",
			status: "warning",
			headline: "warnings",
			facts: [],
			updatedAt: "2026-04-11T10:00:00.000Z",
			primaryLink: { label: "Compliance", href: "/settings/compliance" },
		},
		recentCriticalEvents: [],
	})),
}));

vi.mock("./sections/access-controls", () => ({
	getAccessControlsSection: vi.fn(async () => ({
		card: {
			key: "accessControls",
			status: "critical",
			headline: "critical",
			facts: [],
			updatedAt: "2026-04-11T10:00:00.000Z",
			primaryLink: { label: "Audit Log", href: "/settings/enterprise/audit-log" },
		},
		recentCriticalEvents: [
			{
				id: "evt-1",
				sectionKey: "accessControls",
				severity: "critical",
				title: "Sensitive action",
				description: "details",
				occurredAt: "2026-04-11T10:00:00.000Z",
				primaryLink: { label: "Open", href: "/settings/enterprise/audit-log" },
			},
		],
	})),
}));

import { getComplianceCommandCenterData } from "./loader";

describe("getComplianceCommandCenterData", () => {
	it("assembles all sections, summary, and coverage notes", async () => {
		const data = await getComplianceCommandCenterData("org-1");

		expect(data.sections.map((section) => section.key)).toEqual([
			"auditEvidence",
			"workforceCompliance",
			"accessControls",
		]);
		expect(data.summary.status).toBe("critical");
		expect(data.coverageNotes.length).toBeGreaterThan(0);
	});

	it("falls back to an unavailable card when one section loader throws", async () => {
		const { getAccessControlsSection } = await import("./sections/access-controls");
		vi.mocked(getAccessControlsSection).mockRejectedValueOnce(
			new Error("audit log offline"),
		);

		const data = await getComplianceCommandCenterData("org-1");

		expect(data.sections.find((section) => section.key === "accessControls")?.status).toBe(
			"unavailable",
		);
	});
});
