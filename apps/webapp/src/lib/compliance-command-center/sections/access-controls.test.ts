import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { deriveAccessControlsSection } from "./access-controls";

describe("deriveAccessControlsSection", () => {
	it("marks the section critical when recent permission revocations or access denials exist", () => {
		const result = deriveAccessControlsSection({
			recentSensitiveEvents: [
				{
					id: "evt-1",
					action: "permission.revoked",
					timestamp: DateTime.utc().minus({ minutes: 5 }).toISO()!,
					description: "Removed project export permission",
				},
			],
		});

		expect(result.card.status).toBe("critical");
		expect(result.recentCriticalEvents).toHaveLength(1);
	});

	it("marks the section warning when only non-critical sensitive events exist", () => {
		const result = deriveAccessControlsSection({
			recentSensitiveEvents: [
				{
					id: "evt-2",
					action: "manager.assigned",
					timestamp: DateTime.utc().minus({ minutes: 15 }).toISO()!,
					description: "Assigned a new manager",
				},
			],
		});

		expect(result.card.status).toBe("warning");
		expect(result.recentCriticalEvents[0]?.severity).toBe("warning");
	});

	it("keeps recent critical incidents in the local event slice when newer warnings exist", () => {
		const result = deriveAccessControlsSection({
			recentSensitiveEvents: [
				{
					id: "evt-warning-1",
					action: "manager.assigned",
					timestamp: DateTime.utc().minus({ minutes: 1 }).toISO()!,
					description: "Assigned a manager",
				},
				{
					id: "evt-warning-2",
					action: "manager.removed",
					timestamp: DateTime.utc().minus({ minutes: 2 }).toISO()!,
					description: "Removed a manager",
				},
				{
					id: "evt-warning-3",
					action: "permission.granted",
					timestamp: DateTime.utc().minus({ minutes: 3 }).toISO()!,
					description: "Granted a permission",
				},
				{
					id: "evt-critical-1",
					action: "permission.revoked",
					timestamp: DateTime.utc().minus({ minutes: 4 }).toISO()!,
					description: "Revoked a permission",
				},
			],
		});

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContain("Latest sensitive action: manager.assigned");
		expect(result.recentCriticalEvents.map((event) => event.id)).toContain("evt-critical-1");
	});

	it("stays healthy when there are no recent sensitive control events", () => {
		const result = deriveAccessControlsSection({ recentSensitiveEvents: [] });

		expect(result.card.status).toBe("healthy");
		expect(result.card.facts).toContain(
			"No sensitive control changes were logged in the last 24 hours.",
		);
	});
});
