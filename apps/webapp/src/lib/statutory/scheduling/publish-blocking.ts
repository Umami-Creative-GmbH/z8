/**
 * What the JArbSchG publish block refuses a publication for (#1993). Publishing turns the range's
 * drafts into published shifts and changes nothing else, so, as for an edit of a published shift,
 * it is refused only for blocking findings on those drafts, or blocking findings on other shifts
 * that the drafts newly cause (absent without them) or deepen past their limit. A blocked shift
 * that is already published and that the drafts leave as it is, e.g. another employee's, does not
 * stop the publication: publishing cannot change it.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { shift } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type {
	ComplianceFinding,
	StatutoryComplianceFinding,
} from "@/lib/scheduling/compliance/types";
import { shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { statutoryBlockingScheduleContributors } from "./contributors";
import { deepensBreachedLimit, evaluateStatutoryScheduleFindings } from "./evaluate";
import { statutoryFindingChangeKey } from "./finding-key";
import { publicationBlockingFindings } from "./publication-block";

type Reader = Pick<DatabaseClient, "select" | "query">;

export interface PublicationScope {
	readonly organizationId: string;
	/** Organization timezone. */
	readonly timezone: string;
	/** Organization-local days being published, `[start, endExclusive)`. */
	readonly window: { readonly start: string; readonly endExclusive: string };
	readonly now: Instant;
}

/** The blocking findings of `findings` (the range's evaluation) that the publication causes. */
export async function findingsBlockingPublication(
	db: Reader,
	scope: PublicationScope,
	findings: readonly ComplianceFinding[],
): Promise<StatutoryComplianceFinding[]> {
	const blocking = publicationBlockingFindings(findings);
	if (blocking.length === 0) return [];

	const bounds = shiftDateRangeBounds(
		scope.window.start,
		scope.window.endExclusive,
		scope.timezone,
	);
	const drafts = await db
		.select({ id: shift.id, employeeId: shift.employeeId })
		.from(shift)
		.where(
			and(
				eq(shift.organizationId, scope.organizationId),
				eq(shift.status, "draft"),
				gte(shift.date, bounds.start),
				lt(shift.date, bounds.endExclusive),
			),
		);
	const draftSubjects = new Set(drafts.map((draft) => `shift:${draft.id}`));
	const onDrafts = blocking.filter((finding) => draftSubjects.has(finding.subjectKey));
	// Youth findings depend on the employee's own shifts only: other employees' drafts cannot
	// cause them.
	const draftEmployees = new Set(drafts.flatMap((draft) => draft.employeeId ?? []));
	const elsewhere = blocking.filter(
		(finding) => !draftSubjects.has(finding.subjectKey) && draftEmployees.has(finding.employeeId),
	);
	if (elsewhere.length === 0) return onDrafts;

	const withoutDrafts = new Map(
		(
			await evaluateStatutoryScheduleFindings(
				db,
				{
					organizationId: scope.organizationId,
					timezone: scope.timezone,
					window: scope.window,
					employeeIds: [...new Set(elsewhere.map((finding) => finding.employeeId))],
					now: scope.now,
					excludedShiftIds: drafts.map((draft) => draft.id),
				},
				// Only monitors that can block publication: the publication runs in its transaction.
				statutoryBlockingScheduleContributors,
			)
		).map((finding) => [statutoryFindingChangeKey(finding), finding] as const),
	);
	// As for an edit of a published shift: the drafts cause a breach they bring about, or one
	// they deepen past its limit (a longer week, a shorter rest). One they leave as it is does not
	// block.
	return [
		...onDrafts,
		...elsewhere.filter((finding) => {
			const prior = withoutDrafts.get(statutoryFindingChangeKey(finding));
			return !prior || deepensBreachedLimit(prior, finding);
		}),
	];
}
