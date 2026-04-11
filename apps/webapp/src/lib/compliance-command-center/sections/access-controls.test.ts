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

	it("stays healthy when there are no recent sensitive control events", () => {
		const result = deriveAccessControlsSection({ recentSensitiveEvents: [] });

		expect(result.card.status).toBe("healthy");
		expect(result.card.facts).toContain(
			"No sensitive control changes were logged in the last 24 hours.",
		);
	});
});
