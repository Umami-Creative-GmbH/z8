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
 */
export type KioskOfflineClock = {
	/** A contact: the server's time now (UTC ISO). */
	noteContact(serverTime: string): void;
	/** The instant to claim for a command now, at most millisecond precision. */
	now(): { occurredAt: string; timeSource: KioskTimeSource };
};

export function createKioskOfflineClock(
	deps: { monotonicMilliseconds?: () => number; device?: Clock } = {},
): KioskOfflineClock {
	const monotonic = deps.monotonicMilliseconds ?? (() => performance.now());
	const device = deps.device ?? systemClock;
	let anchor: { serverTime: Instant; monotonicAt: number } | null = null;

	return {
		noteContact(serverTime) {
			try {
				anchor = { serverTime: parseInstant(serverTime), monotonicAt: monotonic() };
			} catch {
				// An unreadable time is no anchor; the last good one stays.
			}
		},
		now() {
			if (!anchor) {
				return {
					occurredAt: instantToCanonicalString(device.nowInstant()),
					timeSource: "device_clock",
				};
			}
			const elapsed = Math.max(0, Math.floor(monotonic() - anchor.monotonicAt));
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
