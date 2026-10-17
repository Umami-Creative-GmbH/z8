import {
	type Clock,
	type Instant,
	instantToCanonicalString,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { KioskTimeSource } from "../clocking/types";

/**
 * When an offline kiosk says a command happened (#1292, spec #885, ADR 0011).
 *
 * At each contact the kiosk notes the server's time (`offline.contact.serverTime`)
 * beside a monotonic clock reading (`performance.now()`), which the user cannot
 * set. A command's instant is that server time plus the monotonic time elapsed
 * since (`server_anchor`). The monotonic clock restarts with every page, so a
 * page that has had no contact (an offline restart or reload) has no base and
 * uses the device clock instead (`device_clock`), which Z8 accepts only between
 * the command's last contact and its arrival.
 *
 * The monotonic clock does not advance while the device is suspended (Chrome on
 * Android and macOS, iOS Safari), so the device clock's elapsed time is noted
 * beside it: when the device clock ran more than a few seconds further than the
 * monotonic one, the device slept (or its clock was set forward), the anchor no
 * longer tells the time and the kiosk uses the device clock until its next
 * contact, which Z8 bounds. A device clock set back changes nothing.
 */
export type KioskOfflineClock = {
	/** A contact: the server's time now (UTC ISO). */
	noteContact(serverTime: string): void;
	/** The instant to claim for a command now, at most millisecond precision. */
	now(): { occurredAt: string; timeSource: KioskTimeSource };
};

/** How much further the device clock may run than the monotonic one before the anchor is dropped. */
export const KIOSK_SUSPEND_TOLERANCE_MS = 5_000;

export function createKioskOfflineClock(
	deps: { monotonicMilliseconds?: () => number; device?: Clock } = {},
): KioskOfflineClock {
	const monotonic = deps.monotonicMilliseconds ?? (() => performance.now());
	const device = deps.device ?? systemClock;
	let anchor: { serverTime: Instant; monotonicAt: number; deviceAt: Instant } | null = null;

	return {
		noteContact(serverTime) {
			try {
				anchor = {
					serverTime: parseInstant(serverTime),
					monotonicAt: monotonic(),
					deviceAt: device.nowInstant(),
				};
			} catch {
				// An unreadable time is no anchor; the last good one stays.
			}
		},
		now() {
			const deviceNow = device.nowInstant();
			const monotonicElapsed = anchor ? monotonic() - anchor.monotonicAt : 0;
			if (
				anchor &&
				deviceNow.epochMilliseconds - anchor.deviceAt.epochMilliseconds - monotonicElapsed >
					KIOSK_SUSPEND_TOLERANCE_MS
			) {
				// The device slept: its monotonic clock missed that time.
				anchor = null;
			}
			if (!anchor) {
				return {
					occurredAt: instantToCanonicalString(
						deviceNow.round({ smallestUnit: "millisecond", roundingMode: "trunc" }),
					),
					timeSource: "device_clock",
				};
			}
			const elapsed = Math.max(0, Math.floor(monotonicElapsed));
			return {
				occurredAt: instantToCanonicalString(
					anchor.serverTime
						.add({ milliseconds: elapsed })
						.round({ smallestUnit: "millisecond", roundingMode: "trunc" }),
				),
				timeSource: "server_anchor",
			};
		},
	};
}

/** The kiosk page's clock: its anchor lives as long as the page. */
export const kioskOfflineClock: KioskOfflineClock = createKioskOfflineClock();
