/**
 * What the JArbSchG publish block's guards (an edit of a published shift, a publication) count as
 * caused (#1993). Shared so both judge a change the same way.
 */
import { and, eq, inArray } from "drizzle-orm";
import { shift } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { apprenticeReleaseScopeOf } from "../apprenticeship/release-conflict-contributor";
import type { StatutoryFinding } from "../finding";
import { youthBreachScopeOf } from "../youth/youth-findings";
import { deepensBreachedLimit } from "./evaluate";

type Reader = Pick<DatabaseClient, "select">;

/**
 * What a blocking breach is about, so a change that carries it elsewhere is a new breach:
 * - a breach the rules attribute by position (rest period, daily and weekly maximum, days per
 *   week): its judged day or compliance week, whichever shift carries it;
 * - an apprentice release conflict: its release day, whichever shift conflicts;
 * - any other breach is about its own work (night, weekend, holiday work, breaks): that finding on
 *   its local day.
 */
export function breachScopeOf(
	finding: Pick<StatutoryFinding, "id" | "kind" | "employeeId" | "periodStart">,
): string {
	return (
		youthBreachScopeOf(finding) ??
		apprenticeReleaseScopeOf(finding) ??
		JSON.stringify([finding.id, "day", finding.periodStart])
	);
}

/** Whether `prior` (before the change) is a blocking breach of the same scope and standing. */
function sameScope(prior: StatutoryFinding, finding: StatutoryFinding, scope: string): boolean {
	return (
		(prior.blocksPublication ?? false) &&
		prior.severity === finding.severity &&
		(prior.summary.tier ?? null) === (finding.summary.tier ?? null) &&
		breachScopeOf(prior) === scope
	);
}

/**
 * The blocking findings of `after` that a change causes, against `before` (the same judgement
 * without the change): a breach in a scope (`breachScopeOf`) that had none, or one the change
 * takes past the deepest breach the scope had (a longer day or week, a shorter rest). A breach the
 * change leaves as it is, or eases, in its scope does not block it, also when it moves to another
 * shift of the same day; carried to another day or week, it is a new breach there.
 */
export function causedBlockingFindings<F extends StatutoryFinding>(
	before: readonly StatutoryFinding[],
	after: readonly F[],
): F[] {
	return after.filter((finding) => {
		if (!finding.blocksPublication) return false;
		const scope = breachScopeOf(finding);
		const priors = before.filter((prior) => sameScope(prior, finding, scope));
		if (priors.length === 0) return true;
		const deepest = priors.reduce((deepest, prior) =>
			deepensBreachedLimit(deepest, prior) ? prior : deepest,
		);
		return deepensBreachedLimit(deepest, finding);
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
