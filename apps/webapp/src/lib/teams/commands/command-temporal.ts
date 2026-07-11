import type { BotTemporalContext } from "@/lib/bot-platform/temporal-context";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";

export function getCommandTemporalContext(ctx: BotCommandContext): BotTemporalContext {
	return (
		ctx.temporal ?? {
			effectiveTimezone: ctx.config.digestTimezone,
			organizationTimezone: ctx.config.digestTimezone,
			locale: ctx.locale,
			timezone: ctx.config.digestTimezone,
			timeFormat: "24h",
			now: systemClock.nowInstant(),
			clock: systemClock,
		}
	);
}

export function elapsedHoursAndMinutes(start: Instant, end: Instant) {
	const minutes = Math.max(0, Math.floor(start.until(end, { largestUnit: "minute" }).minutes));
	return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
