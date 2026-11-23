/**
 * What the JArbSchG publish block refuses a publication for (#1993). Publishing turns the range's
 * drafts into published shifts and changes nothing else, so, as for an edit of a published shift,
 * it is refused only for blocking findings on those drafts, or blocking findings on published
 * shifts that the drafts newly cause (absent without them) or deepen past their limit. A blocked
 * shift that is already published and that the drafts leave as it is, e.g. another employee's, does
 * not stop the publication: publishing cannot change it. A breach on a draft outside the range is
 * judged when that draft is published.
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
import { causedBlockingFindings, publishedShiftSubjects } from "./caused-blocking";
import { statutoryBlockingScheduleContributors } from "./contributors";
import { evaluateStatutoryFindings, toStatutoryComplianceFinding } from "./evaluate";
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

/** A draft of the range: what the publication turns into a published shift. */
export interface PublicationDraft {
	readonly id: string;
	readonly employeeId: string | null;
}

/** The drafts whose `shift.date` lies in `[bounds.start, bounds.endExclusive)`. */
function publicationDraftsWhere(
	organizationId: string,
	bounds: { readonly start: Date; readonly endExclusive: Date },
) {
	return and(
		eq(shift.organizationId, organizationId),
		eq(shift.status, "draft"),
		gte(shift.date, bounds.start),
		lt(shift.date, bounds.endExclusive),
	);
}

/**
 * The range's drafts, locked until `tx` ends: the publication publishes exactly these, after
 * judging them with `findingsBlockingDraftPublication` in the same transaction. A draft saved
 * meanwhile stays a draft; an edit of a locked one waits for the publication.
 */
export async function lockPublicationDrafts(
	tx: Pick<DatabaseClient, "select">,
	organizationId: string,
	bounds: { readonly start: Date; readonly endExclusive: Date },
): Promise<PublicationDraft[]> {
	return tx
		.select({ id: shift.id, employeeId: shift.employeeId })
		.from(shift)
		.where(publicationDraftsWhere(organizationId, bounds))
		.orderBy(shift.id)
		.for("update");
}

/**
 * The blocking findings publishing `drafts` causes, judged afresh (only the monitors that can
 * block publication). Run it in the publication's transaction with drafts from
 * `lockPublicationDrafts`, so nothing is published that was not judged.
 */
export async function findingsBlockingDraftPublication(
	db: Reader,
	scope: PublicationScope,
	drafts: readonly PublicationDraft[],
): Promise<StatutoryComplianceFinding[]> {
	const employeeIds = [...new Set(drafts.flatMap((draft) => draft.employeeId ?? []))];
	if (employeeIds.length === 0) return [];
	const request = {
		organizationId: scope.organizationId,
		timezone: scope.timezone,
		window: scope.window,
		employeeIds,
		now: scope.now,
	};
	// Only monitors that can block publication: the publication runs in its transaction.
	const findings = await evaluateStatutoryFindings(
		db,
		request,
		statutoryBlockingScheduleContributors,
	);
	const blocking = findings.filter((finding) => finding.blocksPublication);
	if (blocking.length === 0) return [];

	const draftSubjects = new Set(drafts.map((draft) => `shift:${draft.id}`));
	const onDrafts = blocking.filter((finding) => draftSubjects.has(finding.subjectKey));
	// Youth findings depend on the employee's own shifts only: other employees' drafts cannot
	// cause them.
	const draftEmployees = new Set(drafts.flatMap((draft) => draft.employeeId ?? []));
	const candidates = blocking.filter(
		(finding) => !draftSubjects.has(finding.subjectKey) && draftEmployees.has(finding.employeeId),
	);
	// Only published shifts go live with the publication. A breach on a draft outside the range
	// (counted as planned work) is judged when that draft is published.
	const published = await publishedShiftSubjects(
		db,
		scope.organizationId,
		candidates.map((finding) => finding.subjectKey),
	);
	const elsewhere = candidates.filter((finding) => published.has(finding.subjectKey));
	if (elsewhere.length === 0) return onDrafts.map(toStatutoryComplianceFinding);

	const withoutDrafts = await evaluateStatutoryFindings(
		db,
		{
			...request,
			employeeIds: [...new Set(elsewhere.map((finding) => finding.employeeId))],
			excludedShiftIds: drafts.map((draft) => draft.id),
		},
		statutoryBlockingScheduleContributors,
	);
	// As for an edit of a published shift: the drafts cause a breach they bring about, or one
	// they deepen past its limit (a longer week, a shorter rest). One they leave as it is, also
	// when it moves to another shift of the day, does not block.
	return [...onDrafts, ...causedBlockingFindings(withoutDrafts, elsewhere)].map(
		toStatutoryComplianceFinding,
	);
}

/**
 * The early check before the planner's acknowledgement: the blocking findings the publication of
 * the range's drafts causes, when `findings` (the range's evaluation) has any blocking one. The
 * publication itself judges its locked drafts again with `findingsBlockingDraftPublication`.
 */
export async function findingsBlockingPublication(
	db: Reader,
	scope: PublicationScope,
	findings: readonly ComplianceFinding[],
): Promise<StatutoryComplianceFinding[]> {
	if (publicationBlockingFindings(findings).length === 0) return [];
	const drafts = await db
		.select({ id: shift.id, employeeId: shift.employeeId })
		.from(shift)
		.where(
			publicationDraftsWhere(
				scope.organizationId,
				shiftDateRangeBounds(scope.window.start, scope.window.endExclusive, scope.timezone),
			),
		);
	return findingsBlockingDraftPublication(db, scope, drafts);
}
