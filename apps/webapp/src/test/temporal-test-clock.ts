import type { Temporal } from "temporal-polyfill";

export function createTestTemporalNow(
	actual: typeof Temporal,
	isFakeClockActive: () => boolean,
): typeof Temporal.Now {
	const instant = () => actual.Instant.fromEpochMilliseconds(Date.now());
	const zoned = (zone?: Parameters<typeof actual.Now.zonedDateTimeISO>[0]) =>
		instant().toZonedDateTimeISO(zone ?? actual.Now.timeZoneId());
	const methods: typeof Temporal.Now = {
		instant: () => (isFakeClockActive() ? instant() : actual.Now.instant()),
		timeZoneId: () => actual.Now.timeZoneId(),
		zonedDateTimeISO: (zone) =>
			isFakeClockActive() ? zoned(zone) : actual.Now.zonedDateTimeISO(zone),
		plainDateTimeISO: (zone) =>
			isFakeClockActive()
				? zoned(zone).toPlainDateTime()
				: actual.Now.plainDateTimeISO(zone),
		plainDateISO: (zone) =>
			isFakeClockActive()
				? zoned(zone).toPlainDate()
				: actual.Now.plainDateISO(zone),
		plainTimeISO: (zone) =>
			isFakeClockActive()
				? zoned(zone).toPlainTime()
				: actual.Now.plainTimeISO(zone),
	};
	const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(
		actual.Now,
	);
	for (const key of Object.keys(methods) as (keyof typeof methods)[]) {
		descriptors[key] = { ...descriptors[key], value: methods[key] };
	}
	return Object.create(Object.getPrototypeOf(actual.Now), descriptors);
}
