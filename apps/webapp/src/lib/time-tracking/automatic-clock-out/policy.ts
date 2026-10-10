import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { AutoClockOutDecision, AutoClockOutSettings } from "./types";

/** Where a decided automatic closure ends: the cutoff, or an earlier break start (#861). */
export function autoClockOutClosureEnd(
	decision: Pick<AutoClockOutDecision, "cutoff" | "closesAt">,
): Instant {
	return decision.closesAt ?? decision.cutoff;
}

export function effectiveAutoClockOutSettings(
	stored: AutoClockOutSettings | null,
): AutoClockOutSettings {
	return (
		stored ?? {
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 720,
			revision: 0,
		}
	);
}

export function parseAutoClockOutDuration(hours: number, minutes: number): number {
	if (
		!Number.isSafeInteger(hours) ||
		hours < 0 ||
		!Number.isInteger(minutes) ||
		minutes < 0 ||
		minutes > 59
	) {
		throw new RangeError("Duration requires nonnegative integral hours and minutes from 0 to 59");
	}
	const total = hours * 60 + minutes;
	if (!Number.isSafeInteger(total) || total < 1 || total > 2_147_483_647) {
		throw new RangeError("Duration must be from 1 to 2147483647 minutes");
	}
	return total;
}

export function autoClockOutCutoff(start: Instant, settings: AutoClockOutSettings): Instant | null {
	return settings.autoClockOutEnabled
		? start.add({ minutes: settings.maxUninterruptedMinutes })
		: null;
}

export function isAutoClockOutDue(
	start: Instant,
	settings: AutoClockOutSettings,
	now: Instant,
): boolean {
	const cutoff = autoClockOutCutoff(start, settings);
	return cutoff !== null && compareInstants(now, cutoff) >= 0;
}
