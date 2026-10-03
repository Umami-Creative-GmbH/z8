import { Temporal } from "temporal-polyfill";
import { formatUtcOffset, offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import type {
	ApprovalInboxTimeComparison,
	ApprovalInboxTimeEndpoint,
	ApprovalInboxTimeRange,
} from "../inbox/types";

export function comparisonEndpointText(endpoint: ApprovalInboxTimeEndpoint): string {
	if (endpoint.utcOffsetMinutes === null) return endpoint.at;
	const local = Temporal.Instant.from(endpoint.at).toZonedDateTimeISO(
		offsetMinutesToTimeZoneId(endpoint.utcOffsetMinutes),
	);
	return `${local.toPlainDate()} ${local.toPlainTime().toString({ smallestUnit: "minute" })} (${formatUtcOffset(endpoint.utcOffsetMinutes)})`;
}

export function comparisonElapsedMinutes(range: ApprovalInboxTimeRange): number | null {
	if (!range.start || !range.end) return null;
	const minutes = Temporal.Instant.from(range.start.at)
		.until(Temporal.Instant.from(range.end.at))
		.total("minutes");
	return minutes >= 0 ? minutes : null;
}

/** One fixed, disclosed axis keeps travel and DST intervals proportional to UTC elapsed time. */
export function timeComparisonLayout(comparison: ApprovalInboxTimeComparison) {
	const offset = comparison.original.start?.utcOffsetMinutes;
	if (offset === null || offset === undefined) return null;
	const zone = offsetMinutesToTimeZoneId(offset);
	const ranges = [comparison.original, comparison.requested];
	const endpoints = ranges
		.flatMap((range) => [range.start, range.end])
		.filter((value): value is ApprovalInboxTimeEndpoint => value !== null);
	if (endpoints.length < 2) return null;
	const instants = endpoints.map((value) => Temporal.Instant.from(value.at));
	const sorted = instants.toSorted(Temporal.Instant.compare);
	const axisStart = sorted[0]
		.toZonedDateTimeISO(zone)
		.round({ smallestUnit: "hour", roundingMode: "floor" })
		.subtract({ hours: 1 });
	const axisEnd = sorted
		.at(-1)!
		.toZonedDateTimeISO(zone)
		.round({ smallestUnit: "hour", roundingMode: "ceil" })
		.add({ hours: 1 });
	const axisMinutes = axisStart.until(axisEnd).total("minutes");
	if (axisMinutes > 48 * 60) return null;
	const position = (at: string) =>
		(axisStart.toInstant().until(Temporal.Instant.from(at)).total("minutes") / axisMinutes) * 100;
	const block = (range: ApprovalInboxTimeRange) => {
		if (!range.start || !range.end || (comparisonElapsedMinutes(range) ?? 0) <= 0) return null;
		return {
			top: position(range.start.at),
			height: position(range.end.at) - position(range.start.at),
		};
	};
	const hours = axisMinutes / 60;
	const step = hours > 16 ? 4 : hours > 8 ? 2 : 1;
	const ticks = Array.from({ length: Math.floor(hours / step) + 1 }, (_, index) => {
		const tick = axisStart.add({ hours: index * step });
		const time = tick.toPlainTime().toString({ smallestUnit: "minute" });
		return {
			at: tick.toInstant().toString(),
			top: ((index * step) / hours) * 100,
			label: tick.toPlainDate().equals(axisStart.toPlainDate())
				? time
				: `${tick.toPlainDate()} ${time}`,
		};
	});
	return {
		offsetLabel: formatUtcOffset(offset),
		original: block(comparison.original),
		requested: block(comparison.requested),
		ticks,
	};
}
