import { DateTime } from "luxon";
import type {
	ComplianceCommandCenterData,
	ComplianceCriticalEvent,
	ComplianceRiskSummary,
	ComplianceSectionCard,
	ComplianceSectionStatus,
} from "./types";

const STATUS_PRIORITY: Record<ComplianceSectionStatus, number> = {
	critical: 3,
	unavailable: 2,
	warning: 1,
	healthy: 0,
};

function buildRiskSummary(
	sections: ComplianceSectionCard[],
	refreshedAt: string,
): ComplianceRiskSummary {
	const highestPriority = Math.max(
		...sections.map((section) => STATUS_PRIORITY[section.status]),
	);
	const status = (Object.entries(STATUS_PRIORITY).find(
		([, value]) => value === highestPriority,
	)?.[0] ?? "healthy") as ComplianceSectionStatus;
	const topRiskKeys = sections
		.filter(
			(section) =>
				STATUS_PRIORITY[section.status] === highestPriority &&
				highestPriority > 0,
		)
		.map((section) => section.key);

	return {
		status,
		headline:
			status === "critical"
				? "Critical compliance risks need attention"
				: status === "warning"
					? "Compliance signals need review"
					: status === "unavailable"
						? "Some compliance signals are unavailable"
						: "No active issues detected in monitored signals",
		topRiskKeys,
		refreshedAt,
	};
}

function sortRecentCriticalEvents(
	events: ComplianceCriticalEvent[],
): ComplianceCriticalEvent[] {
	return [...events]
		.sort(
			(left, right) =>
				DateTime.fromISO(right.occurredAt).toMillis() -
				DateTime.fromISO(left.occurredAt).toMillis(),
		)
		.slice(0, 5);
}

export function buildComplianceCommandCenterData(input: {
	sections: ComplianceSectionCard[];
	recentCriticalEvents: ComplianceCriticalEvent[];
	coverageNotes: string[];
	refreshedAt: string;
}): ComplianceCommandCenterData {
	return {
		refreshedAt: input.refreshedAt,
		summary: buildRiskSummary(input.sections, input.refreshedAt),
		sections: input.sections,
		recentCriticalEvents: sortRecentCriticalEvents(input.recentCriticalEvents),
		coverageNotes: input.coverageNotes,
	};
}
