import { describe, expect, it } from "vitest";
import { evaluateDigestOccurrence } from "./digest-schedule";

describe("evaluateDigestOccurrence", () => {
	it("uses the schedule timezone to derive the due instant", () => {
		const occurrence = evaluateDigestOccurrence({
			now: new Date("2026-07-10T07:05:00.000Z"),
			time: "09:00",
			timezone: "Europe/Berlin",
			windowMinutes: 15,
		});

		expect(occurrence).toEqual({
			due: true,
			logicalDate: "2026-07-10",
			scheduledInstant: "2026-07-10T07:00:00.000Z",
		});
	});

	it("materializes a spring gap at the first valid wall-clock instant", () => {
		const occurrence = evaluateDigestOccurrence({
			now: new Date("2026-03-29T01:35:00.000Z"),
			time: "02:30",
			timezone: "Europe/Berlin",
			windowMinutes: 15,
		});

		expect(occurrence.scheduledInstant).toBe("2026-03-29T01:30:00.000Z");
		expect(occurrence.due).toBe(true);
	});

	it("chooses the earlier occurrence during a fall fold", () => {
		const occurrence = evaluateDigestOccurrence({
			now: new Date("2026-10-25T00:35:00.000Z"),
			time: "02:30",
			timezone: "Europe/Berlin",
			windowMinutes: 15,
		});

		expect(occurrence.scheduledInstant).toBe("2026-10-25T00:30:00.000Z");
		expect(occurrence.due).toBe(true);
	});
});
