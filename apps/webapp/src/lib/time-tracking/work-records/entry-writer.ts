import "server-only";

import { timeEntry } from "@/db/schema";
/**
 * The admission seam of work records: how the time entries of a change are
 * appended to the employee's history. Work records writes the work period, the
 * canonical work record and the effects the same way in both admissions; only
 * the entries differ:
 *
 * - append admission: the append collaborator admits the change, names the
 *   exact predecessor and advances the append position (`appendEntryWriter`);
 * - legacy admission: the legacy head selection (`legacyEntryWriter`, #1219).
 *
 * Retiring legacy admission deletes the legacy adapter; callers never choose.
 */
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "../blockchain";
import { type AppendReviewRequirement, admitTimeEntryAppend } from "../time-entry-append";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { NewEntryProvenance } from "./change";
import type { TimeEntryRow } from "./rows";

/** One entry a change appends. */
export type EntryDraft = {
	type: "clock_in" | "clock_out";
	at: Instant;
	notes: string | null;
	provenance: NewEntryProvenance;
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
	/** Admits the change's entries. In append admission this locks the append position. */
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
 * Legacy admission's entries. Work records does not write in legacy admission
 * until #1219 moves the legacy writers onto it; until then the legacy callers
 * keep their own sequence and never reach this adapter.
 */
function legacyEntryWriter(_tx: WorkTransactionClient, _input: EntryScope): WorkRecordEntryWriter {
	return {
		admission: "legacy",
		async admit() {
			throw new Error("Work records does not write in legacy admission yet (#1219)");
		},
	};
}
