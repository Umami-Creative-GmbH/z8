import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { takeClockPosition } from "./device-position";

const now = parseInstant("2026-09-25T08:00:00Z");

function fix(overrides: Partial<GeolocationCoordinates> = {}, timestamp = now.epochMilliseconds) {
	return {
		coords: {
			latitude: 52.520008,
			longitude: 13.404954,
			accuracy: 18.5,
			altitude: 34,
			altitudeAccuracy: null,
			heading: null,
			speed: null,
			...overrides,
		},
		timestamp: timestamp - 1_500,
	} as unknown as GeolocationPosition;
}

/** A geolocation stand-in that answers when the test says so. */
function geolocation() {
	let success: PositionCallback = () => {};
	let failure: PositionErrorCallback | null | undefined;
	const getCurrentPosition = vi.fn(
		(onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => {
			success = onSuccess;
			failure = onError;
		},
	);
	return {
		api: { getCurrentPosition },
		answer: (position: GeolocationPosition) => success(position),
		fail: () => failure?.({ code: 1, message: "denied" } as GeolocationPositionError),
	};
}

describe("takeClockPosition", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("asks for a fix at most two minutes old within five seconds and keeps only its four fields", async () => {
		const device = geolocation();
		const taken = takeClockPosition({ geolocation: device.api, now: () => now });
		device.answer(fix());

		await expect(taken).resolves.toEqual({
			latitude: 52.520008,
			longitude: 13.404954,
			accuracyMeters: 18.5,
			fixedAt: "2026-09-25T07:59:58.500Z",
		});
		expect(device.api.getCurrentPosition).toHaveBeenCalledWith(
			expect.any(Function),
			expect.any(Function),
			{ enableHighAccuracy: false, timeout: 5_000, maximumAge: 120_000 },
		);
	});

	it("gives up after five seconds even while the permission prompt is still open", async () => {
		const device = geolocation();
		const taken = takeClockPosition({ geolocation: device.api, now: () => now });

		await vi.advanceTimersByTimeAsync(5_000);

		await expect(taken).resolves.toBeNull();
		// A late answer changes nothing.
		device.answer(fix());
	});

	it("is null when the position is denied or unavailable, or the device has no geolocation", async () => {
		const device = geolocation();
		const denied = takeClockPosition({ geolocation: device.api, now: () => now });
		device.fail();

		await expect(denied).resolves.toBeNull();
		await expect(takeClockPosition({ geolocation: null, now: () => now })).resolves.toBeNull();
	});

	it("drops a cached fix older than two minutes and an impossible reading", async () => {
		const stale = geolocation();
		const staleTaken = takeClockPosition({ geolocation: stale.api, now: () => now });
		stale.answer(fix({}, now.epochMilliseconds - 120_000));

		const broken = geolocation();
		const brokenTaken = takeClockPosition({ geolocation: broken.api, now: () => now });
		broken.answer(fix({ latitude: Number.NaN }));

		await expect(staleTaken).resolves.toBeNull();
		await expect(brokenTaken).resolves.toBeNull();
	});
});
