import { DateTime } from "luxon";
import type {
	ComplianceCommandCenterData,
	ComplianceCriticalEvent,
	ComplianceRiskSummary,
	ComplianceSectionCard,
	ComplianceSectionStatus,
	ComplianceText,
} from "./types";

const STATUS_PRIORITY: Record<ComplianceSectionStatus, number> = {
	critical: 3,
	unavailable: 2,
	warning: 1,
	healthy: 0,
};

function text(key: string, params?: Record<string, string | number>): ComplianceText {
	return params ? { key, params } : { key };
}

function buildRiskSummary(
	sections: ComplianceSectionCard[],
	refreshedAt: string,
): ComplianceRiskSummary {
	const highestPriority = Math.max(...sections.map((section) => STATUS_PRIORITY[section.status]));
	const status = (Object.entries(STATUS_PRIORITY).find(
		([, value]) => value === highestPriority,
	)?.[0] ?? "healthy") as ComplianceSectionStatus;
	const topRiskKeys = sections.flatMap((section) =>
		STATUS_PRIORITY[section.status] === highestPriority && highestPriority > 0 ? [section.key] : [],
	);

	return {
		status,
		headline:
			status === "critical"
				? text("compliance.commandCenter.summary.critical")
				: status === "warning"
					? text("compliance.commandCenter.summary.warning")
					: status === "unavailable"
						? text("compliance.commandCenter.summary.unavailable")
						: text("compliance.commandCenter.summary.healthy"),
		topRiskKeys,
		refreshedAt,
	};
}

function sortRecentCriticalEvents(events: ComplianceCriticalEvent[]): ComplianceCriticalEvent[] {
	return [...events]
		.filter((event) => event.severity === "critical")
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
	coverageNotes: ComplianceText[];
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
