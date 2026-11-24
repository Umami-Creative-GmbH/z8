/**
 * The audited acknowledgement history of one statutory subject (#1994), for org admins in
 * Settings → Contracts → Reviews & Conflicts: every `contract_review_acknowledgement` row of the
 * subject, newest first, with who recorded it, when, why and the legal note, and whether it still
 * documents the finding.
 *
 * Which row documents the finding is the monitor's decision (`StatutoryFinding.acknowledgement`),
 * judged against the finding's current input fingerprint: `current` marks the newest row recorded
 * for that fingerprint, `stale` the newest row once newer work, shifts or figures invalidated it,
 * `no_longer_applies` the row recorded for that fingerprint (or else the newest row) when the
 * finding no longer qualifies for an acknowledgement (a Minijob month that became a third
 * exceedance or went above twice the cap), and every other row is `superseded`. Fingerprints never leave the server in the result.
 */
import { inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	listStatutoryAcknowledgements,
	type StatutoryAcknowledgementSubject,
} from "./acknowledgements";

/**
 * Whether a finding's acknowledgement documents it, as its monitor judged: `current` documents it;
 * `stale` was invalidated by newer work, shifts or figures; `no_longer_applies` still matches the
 * finding's figures, but the finding no longer qualifies for one, so it documents nothing.
 */
export type StatutoryAcknowledgementReviewStatus =
	| "none"
	| "current"
	| "stale"
	| "no_longer_applies";

export const statutoryAcknowledgementReviewStatuses = [
	"none",
	"current",
	"stale",
	"no_longer_applies",
] as const satisfies readonly StatutoryAcknowledgementReviewStatus[];

export type StatutoryAcknowledgementHistoryState =
	| "current"
	| "stale"
	| "no_longer_applies"
	| "superseded";

export interface StatutoryAcknowledgementHistoryEntry {
	readonly id: string;
	readonly acknowledgedAt: Date;
	readonly acknowledgedBy: string;
	readonly acknowledgedByName: string;
	readonly reason: string;
	readonly legalNote: string | null;
	readonly state: StatutoryAcknowledgementHistoryState;
}

export async function loadStatutoryAcknowledgementHistory(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly subject: StatutoryAcknowledgementSubject;
		/** The finding's input fingerprint as the monitor evaluated it now. */
		readonly currentInputFingerprint: string;
		/** The finding's acknowledgement status as the monitor judged it (Minijob also by total). */
		readonly currentStatus: StatutoryAcknowledgementReviewStatus;
	},
): Promise<StatutoryAcknowledgementHistoryEntry[]> {
	const rows = await listStatutoryAcknowledgements(db, {
		organizationId: input.organizationId,
		employeeId: input.subject.employeeId,
		kind: input.subject.kind,
		findingKind: input.subject.findingKind,
		subjectKey: input.subject.subjectKey,
	});
	if (rows.length === 0) return [];

	const actors = await db
		.select({
			id: user.id,
			firstName: user.firstName,
			lastName: user.lastName,
			name: user.name,
			email: user.email,
		})
		.from(user)
		.where(inArray(user.id, [...new Set(rows.map((row) => row.acknowledgedBy))]));
	const nameOf = new Map(actors.map((actor) => [actor.id, buildAuthUserDisplayName(actor)]));

	// Rows are newest first: the first match is the one the monitor's state refers to. A finding
	// that no longer qualifies may also have changed since: then its newest row no longer applies.
	const status = input.currentStatus;
	const matching = rows.find((row) => row.inputFingerprint === input.currentInputFingerprint);
	const documenting =
		status === "current"
			? matching
			: status === "no_longer_applies"
				? (matching ?? rows[0])
				: status === "stale"
					? rows[0]
					: undefined;
	return rows.map((row) => ({
		id: row.id,
		acknowledgedAt: row.acknowledgedAt,
		acknowledgedBy: row.acknowledgedBy,
		acknowledgedByName: nameOf.get(row.acknowledgedBy) || row.acknowledgedBy,
		reason: row.reason,
		legalNote: row.legalNote,
		state: row === documenting && status !== "none" ? status : "superseded",
	}));
}
