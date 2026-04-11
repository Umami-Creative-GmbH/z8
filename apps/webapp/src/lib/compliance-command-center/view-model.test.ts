import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildComplianceCommandCenterData } from "./view-model";
import type { ComplianceCriticalEvent, ComplianceSectionCard } from "./types";

const now = DateTime.utc();

function makeSection(
	key: ComplianceSectionCard["key"],
	status: ComplianceSectionCard["status"],
): ComplianceSectionCard {
	return {
		key,
		status,
		headline: `${key}-${status}`,
		facts: [],
		updatedAt: now.toISO(),
		primaryLink: { label: "Open", href: "/settings" },
	};
}

describe("buildComplianceCommandCenterData", () => {
	it("rolls the overall summary up to critical when any section is critical", () => {
		const data = buildComplianceCommandCenterData({
			sections: [
				makeSection("auditEvidence", "healthy"),
				makeSection("workforceCompliance", "critical"),
				makeSection("accessControls", "warning"),
			],
			recentCriticalEvents: [],
			coverageNotes: ["Audit evidence uses live export signals."],
			refreshedAt: now.toISO()!,
		});

		expect(data.summary.status).toBe("critical");
		expect(data.summary.topRiskKeys).toEqual(["workforceCompliance"]);
	});

	it("does not let unavailable sections hide critical risks", () => {
		const data = buildComplianceCommandCenterData({
			sections: [
				makeSection("auditEvidence", "unavailable"),
				makeSection("workforceCompliance", "critical"),
				makeSection("accessControls", "warning"),
			],
			recentCriticalEvents: [],
			coverageNotes: ["Coverage remains partial while one signal is offline."],
			refreshedAt: now.toISO()!,
		});

		expect(data.summary.status).toBe("critical");
		expect(data.summary.topRiskKeys).toEqual(["workforceCompliance"]);
	});

	it("keeps the newest critical events first and drops overflow after five", () => {
		const events: ComplianceCriticalEvent[] = [
			{
				id: "evt-0",
				sectionKey: "auditEvidence",
				severity: "critical",
				title: "Event 0",
				description: "details",
				occurredAt: "2026-04-11T17:00:00Z",
				primaryLink: { label: "Open", href: "/settings/audit-export" },
			},
			{
				id: "evt-1",
				sectionKey: "auditEvidence",
				severity: "warning",
				title: "Event 1",
				description: "details",
				occurredAt: "2026-04-11T16:30:00-01:00",
				primaryLink: { label: "Open", href: "/settings/audit-export" },
			},
			{
				id: "evt-2",
				sectionKey: "auditEvidence",
				severity: "critical",
				title: "Event 2",
				description: "details",
				occurredAt: "2026-04-11T17:15:00+01:00",
				primaryLink: { label: "Open", href: "/settings/audit-export" },
			},
			{
				id: "evt-3",
				sectionKey: "auditEvidence",
				severity: "warning",
				title: "Event 3",
				description: "details",
				occurredAt: "2026-04-11T16:59:00Z",
				primaryLink: { label: "Open", href: "/settings/audit-export" },
			},
			{
				id: "evt-4",
				sectionKey: "auditEvidence",
				severity: "critical",
				title: "Event 4",
				description: "details",
				occurredAt: "2026-04-11T16:58:00Z",
				primaryLink: { label: "Open", href: "/settings/audit-export" },
			},
			{
				id: "evt-5",
				sectionKey: "auditEvidence",
				severity: "warning",
				title: "Event 5",
				description: "details",
				occurredAt: "2026-04-11T16:57:00Z",
				primaryLink: { label: "Open", href: "/settings/audit-export" },
			},
		];

		const data = buildComplianceCommandCenterData({
			sections: [
				makeSection("auditEvidence", "warning"),
				makeSection("workforceCompliance", "healthy"),
				makeSection("accessControls", "healthy"),
			],
			recentCriticalEvents: events,
			coverageNotes: ["Access controls only use audit-log events captured today."],
			refreshedAt: now.toISO()!,
		});

		expect(data.recentCriticalEvents).toHaveLength(5);
		expect(data.recentCriticalEvents.map((event) => event.id)).toEqual([
			"evt-1",
			"evt-0",
			"evt-3",
			"evt-4",
			"evt-5",
		]);
	});
});
