import {
	comparePlainDates,
	type Instant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/** A stretch while driving licence control was switched off; `onAt` is null while it still is. */
export type DrivingLicenceOffPeriod = { offAt: Instant; onAt: Instant | null };

/**
 * Off periods from the policy revisions in version order. A period starts when an
 * enabled policy is switched off and ends at the next switch-on; saves that keep the
 * value, and a policy that was off before it was ever on, open nothing.
 */
export function drivingLicenceOffPeriods(
	revisions: ReadonlyArray<{ enabled: boolean; changedAt: Instant }>,
): DrivingLicenceOffPeriod[] {
	const periods: DrivingLicenceOffPeriod[] = [];
	let open: DrivingLicenceOffPeriod | null = null;
	let wasEnabled = false;
	for (const revision of revisions) {
		if (wasEnabled && !revision.enabled) {
			open = { offAt: revision.changedAt, onAt: null };
			periods.push(open);
		} else if (!wasEnabled && revision.enabled && open) {
			open.onAt = revision.changedAt;
			open = null;
		}
		wasEnabled = revision.enabled;
	}
	return periods;
}

/**
 * True when a deadline reminder's date (`validThrough` minus `leadDays`, in the
 * authorization's deadline timezone) fell while control was off: on or after the
 * switch-off day and before the switch-on day. Such occasions are skipped, not caught
 * up (#1422); an occasion due on the switch-on day itself is still sent.
 */
export function reminderOccasionFellWhileOff(input: {
	validThrough: string;
	leadDays: number;
	timezone: string;
	offPeriods: ReadonlyArray<DrivingLicenceOffPeriod>;
}) {
	const due = parsePlainDate(input.validThrough).subtract({
		days: input.leadDays,
	});
	return input.offPeriods.some(
		(period) =>
			comparePlainDates(due, plainDateAt(period.offAt, input.timezone)) >= 0 &&
			(period.onAt === null ||
				comparePlainDates(due, plainDateAt(period.onAt, input.timezone)) < 0),
	);
}
