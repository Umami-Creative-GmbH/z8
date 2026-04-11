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

	it("keeps the newest critical events first and drops overflow after five", () => {
		const events: ComplianceCriticalEvent[] = Array.from({ length: 6 }, (_, index) => ({
			id: `evt-${index}`,
			sectionKey: "auditEvidence",
			severity: index % 2 === 0 ? "critical" : "warning",
			title: `Event ${index}`,
			description: "details",
			occurredAt: now.minus({ minutes: index }).toISO()!,
			primaryLink: { label: "Open", href: "/settings/audit-export" },
		}));

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
		expect(data.recentCriticalEvents[0]?.id).toBe("evt-0");
		expect(data.recentCriticalEvents[1]?.id).toBe("evt-1");
	});
});
