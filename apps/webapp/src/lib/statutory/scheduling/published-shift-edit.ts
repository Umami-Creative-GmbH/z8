/**
 * The publish block on edits of published shifts (#1993). Saving a published shift keeps it
 * published, so a new date, time or assignee would go live without the publish gate. While the
 * organization blocks JArbSchG shift publication, the save runs the same statutory check for the
 * shift's day before and after the edit, and is refused when it newly blocks publication of the
 * edited shift or of another published shift of the same employee, or deepens such a block past
 * its limit. A blocking breach the edit leaves no worse in its scope (its judged day or week, its
 * release day, or its own shift on its day) does not refuse the save, also when a reordered day
 * moves it to another shift; carried to a day or week that had none, it is a new breach there
 * (`causedBlockingFindings`). A current sector exception lifts the block as at
 * publication. Drafts are judged when they are published.
 */
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { StatutoryFinding } from "../finding";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { causedBlockingFindings, publishedShiftSubjects } from "./caused-blocking";
import { statutoryBlockingScheduleContributors } from "./contributors";
import { evaluateStatutoryFindings, toStatutoryComplianceFinding } from "./evaluate";

type Reader = Pick<DatabaseClient, "select" | "query">;

export interface PublishedShiftEdit {
	readonly organizationId: string;
	/** Organization timezone. */
	readonly timezone: string;
	readonly shiftId: string;
	/** Whether the shift was published before the save. */
	readonly published: boolean;
	/** The assignee after the save. */
	readonly employeeId: string | null;
	/** Organization-local shift date after the save. */
	readonly date: PlainDate;
	/** Organization-local shift date before the save, when the edit may move the shift. */
	readonly previousDate?: PlainDate;
	readonly now: Instant;
}

/** The refusal raised inside the save transaction so the write rolls back. */
export class PublishedShiftEditBlocked extends Error {
	constructor(readonly blocking: readonly StatutoryComplianceFinding[]) {
		super("statutory_publication_blocked");
	}
}

/**
 * Runs `write` (which saves the shift) and refuses the save by throwing `PublishedShiftEditBlocked`
 * when it breaks the publish block. Call it inside the save's transaction with that transaction.
 */
export async function guardPublishedShiftEdit<T>(
	db: Reader,
	edit: PublishedShiftEdit,
	write: () => Promise<T>,
): Promise<T> {
	if (!edit.published || !edit.employeeId) return write();
	const preferences = await loadOrganizationStatutoryPreferences(db, edit.organizationId);
	if (!preferences.blockJarbschgShiftPublish) return write();

	const employeeId = edit.employeeId;
	// Before and after are judged on the same days: the shift's day before the save and after it.
	// A breach the shift takes with it to another day is then the same finding on both sides.
	const days = [edit.date];
	if (edit.previousDate && !edit.previousDate.equals(edit.date)) days.push(edit.previousDate);
	// Only monitors that can block publication: the save holds the shift row locked. One day after
	// another: `db` is the save's transaction (one connection).
	const evaluate = async () => {
		const findings: StatutoryFinding[] = [];
		for (const day of days) {
			findings.push(
				...(await evaluateStatutoryFindings(
					db,
					{
						organizationId: edit.organizationId,
						timezone: edit.timezone,
						window: { start: day.toString(), endExclusive: day.add({ days: 1 }).toString() },
						employeeIds: [employeeId],
						now: edit.now,
					},
					statutoryBlockingScheduleContributors,
				)),
			);
		}
		return findings;
	};
	const before = await evaluate();
	const saved = await write();
	// Only what the edit causes blocks it: a blocking finding absent before the save, or one it
	// deepens past its limit (a longer week, a shorter rest). A breach the shift already had (e.g.
	// published before the org turned the block on) does not lock its notes, colour or an edit
	// that eases it, also when the edit reorders the day and the breach moves to another shift.
	const caused = causedBlockingFindings(before, await evaluate());
	if (caused.length === 0) return saved;

	const edited = `shift:${edit.shiftId}`;
	const published = await publishedShiftSubjects(
		db,
		edit.organizationId,
		caused.flatMap((finding) => (finding.subjectKey === edited ? [] : [finding.subjectKey])),
	);
	const blocking = caused.filter(
		(finding) => finding.subjectKey === edited || published.has(finding.subjectKey),
	);
	if (blocking.length > 0) {
		throw new PublishedShiftEditBlocked(blocking.map(toStatutoryComplianceFinding));
	}
	return saved;
}
