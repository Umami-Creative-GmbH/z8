import { Temporal } from "temporal-polyfill";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { type ClockCommandPosition, clockCommandPositionSchema } from "../clock-command";

/** The clock event never waits longer than this for a position (#826). */
export const POSITION_FIX_TIMEOUT_MS = 5_000;
/** A cached fix may be used if the device determined it at most this long ago. */
export const POSITION_MAX_AGE_MS = 120_000;

type GeolocationLike = Pick<Geolocation, "getCurrentPosition">;

function browserGeolocation(): GeolocationLike | null {
	return typeof navigator !== "undefined" && "geolocation" in navigator
		? navigator.geolocation
		: null;
}

/**
 * Takes the device position for a clock event (#826): one fix, a cached one up
 * to two minutes old allowed, within five seconds in total. The browser's own
 * timeout does not run while its permission prompt is open, so a timer of our
 * own bounds the wait. Denied, unavailable, timed-out, stale or impossible
 * readings resolve to null; the clock event goes ahead without a position and
 * nothing records why. Only latitude, longitude, accuracy and the fix time are
 * kept.
 */
export function takeClockPosition(
	options: { geolocation?: GeolocationLike | null; now?: () => Instant } = {},
): Promise<ClockCommandPosition | null> {
	const geolocation =
		options.geolocation === undefined ? browserGeolocation() : options.geolocation;
	const now = options.now ?? (() => systemClock.nowInstant());
	if (!geolocation) return Promise.resolve(null);
	return new Promise((resolve) => {
		let settled = false;
		const settle = (position: ClockCommandPosition | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(position);
		};
		const timer = setTimeout(() => settle(null), POSITION_FIX_TIMEOUT_MS);
		try {
			geolocation.getCurrentPosition(
				(fix) => settle(readFix(fix, now())),
				() => settle(null),
				{
					enableHighAccuracy: false,
					timeout: POSITION_FIX_TIMEOUT_MS,
					maximumAge: POSITION_MAX_AGE_MS,
				},
			);
		} catch {
			settle(null);
		}
	});
}

function readFix(fix: GeolocationPosition, now: Instant): ClockCommandPosition | null {
	if (!Number.isFinite(fix.timestamp)) return null;
	if (now.epochMilliseconds - fix.timestamp > POSITION_MAX_AGE_MS) return null;
	const parsed = clockCommandPositionSchema.safeParse({
		latitude: fix.coords.latitude,
		longitude: fix.coords.longitude,
		accuracyMeters: fix.coords.accuracy,
		fixedAt: Temporal.Instant.fromEpochMilliseconds(Math.trunc(fix.timestamp)).toString({
			fractionalSecondDigits: 3,
		}),
	});
	return parsed.success ? parsed.data : null;
}
