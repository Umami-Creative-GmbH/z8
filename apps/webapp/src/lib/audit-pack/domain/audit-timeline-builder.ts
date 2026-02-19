import { DateTime } from "luxon";
import type { AuditTimelineEvent, AuditTimelineInputEvent, AuditTimelineSource } from "./types";

const SOURCE_ORDER: Record<AuditTimelineSource, number> = {
	entry: 0,
	approval: 1,
	audit_log: 2,
};

function normalizeIsoTimestamp(timestamp: string): string {
	const parsed = DateTime.fromISO(timestamp, { setZone: true });
	if (!parsed.isValid) {
		return timestamp;
	}

	return (
		parsed
			.toUTC()
			.toISO({ includeOffset: true, suppressMilliseconds: false, suppressSeconds: false }) ?? timestamp
	);
}

export function normalizeAuditTimelineEvent(input: AuditTimelineInputEvent): AuditTimelineEvent {
	return {
		id: input.id,
		source: input.source,
		occurredAt: normalizeIsoTimestamp(input.occurredAt),
	};
}

export function buildAuditTimeline(events: readonly AuditTimelineInputEvent[]): AuditTimelineEvent[] {
	return events
		.map((event) => normalizeAuditTimelineEvent(event))
		.sort((a, b) => {
			if (a.occurredAt !== b.occurredAt) {
				return a.occurredAt.localeCompare(b.occurredAt);
			}

			const sourceCompare = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
			if (sourceCompare !== 0) {
				return sourceCompare;
			}

			return a.id.localeCompare(b.id);
		});
}
