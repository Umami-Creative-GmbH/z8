/**
 * What the JArbSchG publish block's guards (an edit of a published shift, a publication) count as
 * caused (#1993). Shared so both judge a change the same way.
 */
import { and, eq, inArray } from "drizzle-orm";
import { shift } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryFinding } from "../finding";
import { youthBreachScopeOf } from "../youth/youth-findings";
import { deepensBreachedLimit } from "./evaluate";

type Reader = Pick<DatabaseClient, "select">;

/** Whether `prior` (before the change) is the blocking breach `finding` (after it) already was. */
function sameBreach(prior: StatutoryFinding, finding: StatutoryFinding): boolean {
	if (!prior.blocksPublication) return false;
	if (prior.severity !== finding.severity) return false;
	if ((prior.summary.tier ?? null) !== (finding.summary.tier ?? null)) return false;
	// The same finding, also when the change takes its shift to another day; or a breach the rules
	// attribute by position (the day's first shift, the shift past the running cap) on the same
	// judged day or week, wherever the change moved it.
	if (prior.id === finding.id) return true;
	const scope = youthBreachScopeOf(finding);
	return scope !== null && youthBreachScopeOf(prior) === scope;
}

/**
 * The blocking findings of `after` that a change causes, against `before` (the same judgement
 * without the change): a breach that was not there, or one the change deepens past its limit (a
 * longer day or week, a shorter rest). A breach the change leaves as it is, or eases, does not
 * block it, also when it moves to another shift of the same day.
 */
export function causedBlockingFindings<F extends StatutoryFinding>(
	before: readonly StatutoryFinding[],
	after: readonly F[],
): F[] {
	return after.filter((finding) => {
		if (!finding.blocksPublication) return false;
		// No such breach before (caused), or deeper than each one there was.
		return before
			.filter((prior) => sameBreach(prior, finding))
			.every((prior) => deepensBreachedLimit(prior, finding));
	});
}

const SHIFT_SUBJECT = /^shift:([0-9a-f-]{36})$/i;

/**
 * The subjects of `subjectKeys` that are published shifts of the organization. A finding on a
 * draft is judged when that draft is published; recorded work cannot be unpublished.
 */
export async function publishedShiftSubjects(
	db: Reader,
	organizationId: string,
	subjectKeys: Iterable<string>,
): Promise<Set<string>> {
	const ids = [
		...new Set(
			[...subjectKeys].flatMap((subjectKey) => {
				const match = SHIFT_SUBJECT.exec(subjectKey);
				return match ? [match[1]] : [];
			}),
		),
	];
	if (ids.length === 0) return new Set();
	const rows = await db
		.select({ id: shift.id })
		.from(shift)
		.where(
			and(
				eq(shift.organizationId, organizationId),
				inArray(shift.id, ids),
				eq(shift.status, "published"),
			),
		);
	return new Set(rows.map((row) => `shift:${row.id}`));
}
