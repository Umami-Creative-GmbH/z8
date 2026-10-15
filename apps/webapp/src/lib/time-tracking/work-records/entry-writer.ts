import "server-only";

/**
 * The admission seam of work records: how the time entries of a change are
 * appended to the employee's history, and how written work rounds its minutes.
 * Work records writes the work period, the canonical work record and the
 * effects the same way in both admissions; only the admission's writer differs:
 *
 * - append admission (`appendEntryWriter`): the append collaborator admits the
 *   change, names the exact predecessor and advances the append position; each
 *   interval's minutes round half up.
 * - legacy admission (`legacyEntryWriter`, #1219): the legacy writers' rules.
 *   Entries chain after the employee's latest entry (the latest-entry head);
 *   an entry that takes over from an endpoint and carries notes supersedes it;
 *   each interval's minutes are floored.
 *
 * Retiring legacy admission deletes the legacy adapter; callers never choose.
 */
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { timeEntry } from "@/db/schema";
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "../blockchain";
import { CompletedWorkIntegrityError } from "../close-active-work";
import { type AppendReviewRequirement, admitTimeEntryAppend } from "../time-entry-append";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { NewEntryProvenance } from "./change";
import type { WorkDurationArithmetic } from "./plan";
import type { TimeEntryRow } from "./rows";

/** One entry a change appends. */
export type EntryDraft = {
	/** An operation identity the entry takes (a clock command's); generated when omitted. */
	id?: string;
	type: "clock_in" | "clock_out" | "correction";
	at: Instant;
	notes: string | null;
	provenance: NewEntryProvenance;
	/**
	 * The endpoint whose place this entry takes for the changed work, while that
	 * endpoint still stands elsewhere: a division's new clock-out ends the
	 * retained half in place of the source clock-out, which keeps ending the
	 * generated half. Only legacy admission acts on it (see `legacyEntryWriter`).
	 */
	takesOverFrom?: TimeEntryRow;
	/**
	 * The endpoint this correction replaces (#1225), in both admissions: the
	 * entry names it as `replaces_entry_id` and supersedes it. Its hash stays
	 * predecessor evidence. An endpoint already superseded (legacy only: the
	 * source clock-out a legacy split's generated half keeps) stays superseded
	 * by what superseded it first.
	 */
	replaces?: TimeEntryRow;
};

/** An admitted change: appends its entries, in order, each after the previous. */
export interface AdmittedEntries {
	append(drafts: readonly EntryDraft[]): Promise<TimeEntryRow[]>;
}

export type EntryAdmission =
	| { kind: "admitted"; entries: AdmittedEntries }
	| { kind: "review_required"; requirement: AppendReviewRequirement };

export interface WorkRecordEntryWriter {
	readonly admission: "append" | "legacy";
	/** How the admission rounds the minutes of the work it writes; the plan step applies it. */
	readonly durationArithmetic: WorkDurationArithmetic;
	/**
	 * Admits the change's entries: the last step before the first write, after
	 * every refusal. In append admission this locks the append position.
	 */
	admit(): Promise<EntryAdmission>;
}

type EntryScope = {
	organizationId: string;
	employeeId: string;
	/** Recorded on the append position as the operation that advanced it. */
	operation: TimeEntryAppendOperation;
};

/** The entry writer of the scope's admission. */
export function entryWriterFor(
	scope: SealedWorkTransactionScope,
	input: EntryScope,
): WorkRecordEntryWriter {
	return scope.admission === "append"
		? appendEntryWriter(scope.db, input)
		: legacyEntryWriter(scope.db, input);
}

function appendEntryWriter(tx: WorkTransactionClient, input: EntryScope): WorkRecordEntryWriter {
	return {
		admission: "append",
		durationArithmetic: "half_up",
		async admit() {
			const admission = await admitTimeEntryAppend(
				tx,
				{ organizationId: input.organizationId, employeeId: input.employeeId },
				input.operation,
			);
			if (admission.kind === "review_required") return admission;
			const { append } = admission;
			let previous = {
				id: append.predecessor?.id ?? null,
				hash: append.predecessor?.hash ?? null,
			};
			return {
				kind: "admitted",
				entries: {
					async append(drafts) {
						const written: TimeEntryRow[] = [];
						for (const draft of drafts) {
							const entry = await insertAppendedEntry(tx, input, draft, previous);
							if (draft.replaces) await supersedeEndpoint(tx, draft.replaces, entry);
							await append.record({
								id: entry.id,
								hash: entry.hash,
								previousEntryId: previous.id,
								previousHash: previous.hash,
							});
							previous = { id: entry.id, hash: entry.hash };
							written.push(entry);
						}
						return written;
					},
				},
			};
		},
	};
}

async function insertAppendedEntry(
	tx: WorkTransactionClient,
	scope: EntryScope,
	draft: EntryDraft,
	previous: { id: string | null; hash: string | null },
): Promise<TimeEntryRow> {
	const timestamp = dateFromInstant(draft.at);
	const [entry] = await tx
		.insert(timeEntry)
		.values({
			...(draft.id === undefined ? {} : { id: draft.id }),
			...(previous.id === null ? {} : { createdAt: createdAfter(previous.id, scope) }),
			employeeId: scope.employeeId,
			organizationId: scope.organizationId,
			type: draft.type,
			timestamp,
			hash: calculateHash({
				employeeId: scope.employeeId,
				type: draft.type,
				timestamp: timestamp.toISOString(),
				previousHash: previous.hash,
			}),
			previousHash: previous.hash,
			previousEntryId: previous.id,
			replacesEntryId: draft.replaces?.id ?? null,
			notes: draft.notes,
			ipAddress: draft.provenance.ipAddress,
			deviceInfo: draft.provenance.deviceInfo,
			createdBy: draft.provenance.createdBy,
			utcOffsetMinutes: draft.provenance.capture.utcOffsetMinutes,
			timezone: draft.provenance.capture.timezone,
			timezoneSource: draft.provenance.capture.timezoneSource,
		})
		.returning();
	if (!entry) throw new Error("Work records entry insert failed");
	return entry;
}

/**
 * A creation time strictly after the predecessor's, and never before the
 * transaction's, in both admissions: entries written in one transaction would
 * otherwise share `now()`, and the latest-entry head of the next legacy change
 * (or of legacy admission, should an organization return to it) could pick an
 * earlier one of them (#1223).
 */
function createdAfter(previousId: string, scope: EntryScope): SQL<Date> {
	return sql<Date>`greatest(now(), (select ${timeEntry.createdAt} + interval '1 microsecond' from ${timeEntry} where ${timeEntry.id} = ${previousId} and ${timeEntry.organizationId} = ${scope.organizationId}))`;
}

/**
 * Legacy admission's writer, the rules the legacy writers have always followed:
 *
 * - the head is the employee's latest entry by creation (ties by id), read
 *   without a lock: the coordinator's employee guard already serializes the
 *   employee's writers, and a row lock here would break `WORK_RECORD_LOCK_ORDER`.
 *   Later entries of the same change chain after the one before, and every
 *   entry is created after its predecessor, so a later change in the same
 *   transaction finds the latest one as its head (#1223).
 * - an entry that takes over from an endpoint and carries notes supersedes that
 *   endpoint, as the legacy split did with its new clock-out (#304's legacy path).
 * - minutes are floored.
 *
 * Legacy admission always admits; there is no append position to review.
 */
function legacyEntryWriter(tx: WorkTransactionClient, input: EntryScope): WorkRecordEntryWriter {
	return {
		admission: "legacy",
		durationArithmetic: "floor",
		async admit() {
			return {
				kind: "admitted",
				entries: {
					async append(drafts) {
						const [head] = await tx
							.select({ id: timeEntry.id, hash: timeEntry.hash })
							.from(timeEntry)
							.where(
								and(
									eq(timeEntry.organizationId, input.organizationId),
									eq(timeEntry.employeeId, input.employeeId),
								),
							)
							.orderBy(desc(timeEntry.createdAt), desc(timeEntry.id))
							.limit(1);
						let previous = { id: head?.id ?? null, hash: head?.hash ?? null };
						const written: TimeEntryRow[] = [];
						for (const draft of drafts) {
							const entry = await insertAppendedEntry(tx, input, draft, previous);
							if (draft.takesOverFrom && draft.notes) {
								await supersedeEndpoint(tx, draft.takesOverFrom, entry);
							}
							if (draft.replaces) await supersedeEndpoint(tx, draft.replaces, entry);
							previous = { id: entry.id, hash: entry.hash };
							written.push(entry);
						}
						return written;
					},
				},
			};
		},
	};
}

/**
 * Supersedes an endpoint, unless that one already is: a legacy split's generated
 * half keeps the source clock-out an earlier split superseded, and it stays
 * superseded by what superseded it first.
 */
async function supersedeEndpoint(
	tx: WorkTransactionClient,
	endpoint: TimeEntryRow,
	by: TimeEntryRow,
): Promise<void> {
	if (endpoint.isSuperseded) return;
	const superseded = await tx
		.update(timeEntry)
		.set({ isSuperseded: true, supersededById: by.id })
		.where(
			and(
				eq(timeEntry.id, endpoint.id),
				eq(timeEntry.organizationId, endpoint.organizationId),
				eq(timeEntry.employeeId, endpoint.employeeId),
				eq(timeEntry.isSuperseded, false),
			),
		)
		.returning({ id: timeEntry.id });
	if (superseded.length !== 1) {
		throw new CompletedWorkIntegrityError("Endpoint changed under its lock");
	}
}
