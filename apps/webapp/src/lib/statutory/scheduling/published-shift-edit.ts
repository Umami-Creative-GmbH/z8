/**
 * The publish block on edits of published shifts (#1993). Saving a published shift keeps it
 * published, so a new date, time or assignee would go live without the publish gate. While the
 * organization blocks JArbSchG shift publication, the save runs the same statutory check for the
 * shift's day and is refused when a finding blocks publication of the edited shift, or newly
 * blocks another published shift of the same employee. A current sector exception lifts the
 * block as at publication. Drafts are judged when they are published.
 */
import { and, eq, inArray } from "drizzle-orm";
import { shift } from "@/db/schema";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { evaluateStatutoryScheduleFindings } from "./evaluate";
import { statutoryFindingChangeKey } from "./finding-key";

type Reader = Pick<DatabaseClient, "select">;

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
	readonly now: Instant;
}

/** The refusal raised inside the save transaction so the write rolls back. */
export class PublishedShiftEditBlocked extends Error {
	constructor(readonly blocking: readonly StatutoryComplianceFinding[]) {
		super("statutory_publication_blocked");
	}
}

const SHIFT_SUBJECT = /^shift:([0-9a-f-]{36})$/i;

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

	const request = {
		organizationId: edit.organizationId,
		timezone: edit.timezone,
		window: { start: edit.date.toString(), endExclusive: edit.date.add({ days: 1 }).toString() },
		employeeIds: [edit.employeeId],
		now: edit.now,
	};
	const before = new Set(
		(await evaluateStatutoryScheduleFindings(db, request)).map(statutoryFindingChangeKey),
	);
	const saved = await write();
	const after = (await evaluateStatutoryScheduleFindings(db, request)).filter(
		(finding) => finding.blocksPublication,
	);
	if (after.length === 0) return saved;

	const edited = `shift:${edit.shiftId}`;
	const others = after.filter(
		(finding) => finding.subjectKey !== edited && !before.has(statutoryFindingChangeKey(finding)),
	);
	const otherIds = others.flatMap((finding) => {
		const match = SHIFT_SUBJECT.exec(finding.subjectKey);
		return match ? [match[1]] : [];
	});
	const published = new Set(
		otherIds.length === 0
			? []
			: (
					await db
						.select({ id: shift.id })
						.from(shift)
						.where(
							and(
								eq(shift.organizationId, edit.organizationId),
								inArray(shift.id, otherIds),
								eq(shift.status, "published"),
							),
						)
				).map((row) => `shift:${row.id}`),
	);
	const blocking = after.filter(
		(finding) =>
			finding.subjectKey === edited ||
			(others.includes(finding) && published.has(finding.subjectKey)),
	);
	if (blocking.length > 0) throw new PublishedShiftEditBlocked(blocking);
	return saved;
}
