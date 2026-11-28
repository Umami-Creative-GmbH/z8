/**
 * Which outstanding days a leave notice covers (#2082, spec #2057).
 *
 * A notice covers at most the days it stated, and only days of its own leave year that are still
 * outstanding. Days covered by a notice whose opportunity to take leave HR has documented have the
 * evidence that notice-based expiry (#2084) needs; days covered by a notice without that
 * assessment, and days no notice covers, stay outstanding. Days added after a notice therefore need
 * a new notice and opportunity assessment before any evidence covers them.
 *
 * This module is pure; `leave-notice-store.ts` supplies the notices and the outstanding days.
 */
import { Temporal } from "temporal-polyfill";

/** A leave notice as coverage sees it, whether given outside Z8 or (later) through Z8. */
export interface CoverableLeaveNotice {
	id: string;
	leaveYear: number;
	/** The days the notice asked the employee to take. */
	days: number;
	/** Organization-local delivery date (`YYYY-MM-DD`). */
	deliveredOn: string;
	/** The deadline the notice stated: its last valid instant. */
	deadline: Temporal.Instant;
	/** HR documented the employee's opportunity to take the covered days by the deadline. */
	opportunityDocumented: boolean;
}

export interface NoticeCoverage {
	id: string;
	/** Outstanding days the notice covers with a documented opportunity to take them. */
	coveredDays: number;
	/** Outstanding days the notice covers whose opportunity HR has not documented yet. */
	awaitingOpportunityDays: number;
}

export interface LeaveYearNoticeCoverage {
	leaveYear: number;
	outstandingDays: number;
	coveredDays: number;
	awaitingOpportunityDays: number;
	/** Outstanding days no notice covers: they need a new notice and opportunity assessment. */
	uncoveredDays: number;
	/** Each notice of the leave year, earliest deadline first. */
	notices: NoticeCoverage[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function compareNotices(left: CoverableLeaveNotice, right: CoverableLeaveNotice): number {
	return (
		Temporal.Instant.compare(left.deadline, right.deadline) ||
		left.deliveredOn.localeCompare(right.deliveredOn) ||
		left.id.localeCompare(right.id)
	);
}

/**
 * The coverage of each leave year that has outstanding days or notices, oldest year first.
 * Notices with a documented opportunity cover first, earliest deadline first; notices awaiting an
 * assessment take what is left. Notices never cover the same day twice.
 */
export function leaveNoticeCoverage(
	outstanding: ReadonlyMap<number, number>,
	notices: readonly CoverableLeaveNotice[],
): LeaveYearNoticeCoverage[] {
	const years = new Set<number>(notices.map((notice) => notice.leaveYear));
	for (const [year, days] of outstanding) if (days > 0) years.add(year);
	return [...years]
		.toSorted((a, b) => a - b)
		.map((leaveYear) => {
			const outstandingDays = round2(Math.max(0, outstanding.get(leaveYear) ?? 0));
			const ofYear = notices
				.filter((notice) => notice.leaveYear === leaveYear)
				.toSorted(compareNotices);
			const coverage = new Map(
				ofYear.map((notice) => [
					notice.id,
					{ id: notice.id, coveredDays: 0, awaitingOpportunityDays: 0 },
				]),
			);
			let open = outstandingDays;
			for (const documented of [true, false]) {
				for (const notice of ofYear) {
					if (notice.opportunityDocumented !== documented) continue;
					const take = round2(Math.min(open, Math.max(0, notice.days)));
					open = round2(open - take);
					const entry = coverage.get(notice.id) as NoticeCoverage;
					if (documented) entry.coveredDays = take;
					else entry.awaitingOpportunityDays = take;
				}
			}
			const rows = [...coverage.values()];
			const coveredDays = round2(rows.reduce((sum, row) => sum + row.coveredDays, 0));
			const awaitingOpportunityDays = round2(
				rows.reduce((sum, row) => sum + row.awaitingOpportunityDays, 0),
			);
			return {
				leaveYear,
				outstandingDays,
				coveredDays,
				awaitingOpportunityDays,
				uncoveredDays: open,
				notices: rows,
			};
		});
}
