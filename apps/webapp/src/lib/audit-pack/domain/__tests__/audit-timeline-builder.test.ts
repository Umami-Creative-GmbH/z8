import { describe, expect, it } from "vitest";
import { buildAuditTimeline } from "../audit-timeline-builder";

describe("buildAuditTimeline", () => {
	it("sorts deterministically by timestamp then source then id", () => {
		const timeline = buildAuditTimeline([
			{ id: "approval-1", source: "approval", occurredAt: "2026-02-01T10:00:00.000Z" },
			{ id: "audit-1", source: "audit_log", occurredAt: "2026-02-01T10:00:00.000Z" },
			{ id: "entry-2", source: "entry", occurredAt: "2026-02-01T10:00:00.000Z" },
			{ id: "entry-1", source: "entry", occurredAt: "2026-02-01T10:00:00.000Z" },
			{ id: "entry-0", source: "entry", occurredAt: "2026-02-01T09:59:59.000Z" },
		]);

		expect(timeline.map((event) => event.id)).toEqual([
			"entry-0",
			"entry-1",
			"entry-2",
			"approval-1",
			"audit-1",
		]);
	});

	it("normalizes ISO values before deterministic sorting", () => {
		const timeline = buildAuditTimeline([
			{ id: "approval-1", source: "approval", occurredAt: "2026-02-01T10:00:00.000Z" },
			{ id: "entry-1", source: "entry", occurredAt: "2026-02-01T11:00:00.000+01:00" },
		]);

		expect(timeline.map((event) => event.id)).toEqual(["entry-1", "approval-1"]);
		expect(timeline[0]?.occurredAt).toBe("2026-02-01T10:00:00.000Z");
		expect(timeline[1]?.occurredAt).toBe("2026-02-01T10:00:00.000Z");
	});
});
