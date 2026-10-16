import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createKioskOfflineClock } from "./offline-clock";

/**
 * #1292: when an offline kiosk says a command happened. Server time from the
 * last contact plus a clock the user cannot change; after a restart without a
 * contact, the device clock, marked so.
 */
function fakeClocks(input: { monotonic: number; device: string }) {
	const clocks = { monotonic: input.monotonic, device: parseInstant(input.device) };
	return {
		clocks,
		clock: createKioskOfflineClock({
			monotonicMilliseconds: () => clocks.monotonic,
			device: { nowInstant: () => clocks.device },
		}),
	};
}

describe("kiosk offline clock (#1292)", () => {
	it("anchors to the server time of the last contact plus monotonic elapsed time", () => {
		const { clocks, clock } = fakeClocks({ monotonic: 1_000, device: "2026-10-16T12:00:00Z" });

		clock.noteContact("2026-10-16T08:00:00Z");
		clocks.monotonic += 90_500.75;
		// The device clock is wrong and changing it changes nothing.
		clocks.device = parseInstant("2030-01-01T00:00:00Z");

		expect(clock.now()).toEqual({
			occurredAt: "2026-10-16T08:01:30.5Z",
			timeSource: "server_anchor",
		});
	});

	it("uses the device clock, marked so, while this page has had no contact (an offline restart)", () => {
		const { clock } = fakeClocks({ monotonic: 5, device: "2026-10-16T09:15:42.123Z" });

		expect(clock.now()).toEqual({
			occurredAt: "2026-10-16T09:15:42.123Z",
			timeSource: "device_clock",
		});
	});

	it("re-anchors at each contact", () => {
		const { clocks, clock } = fakeClocks({ monotonic: 0, device: "2026-10-16T12:00:00Z" });
		clock.noteContact("2026-10-16T08:00:00Z");
		clocks.monotonic = 60_000;
		clock.noteContact("2026-10-16T08:05:00Z");
		clocks.monotonic = 61_000;

		expect(clock.now().occurredAt).toBe("2026-10-16T08:05:01Z");
	});

	it("ignores a contact time it cannot read", () => {
		const { clock } = fakeClocks({ monotonic: 0, device: "2026-10-16T12:00:00Z" });
		clock.noteContact("yesterday");

		expect(clock.now().timeSource).toBe("device_clock");
	});
});
