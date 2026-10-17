/**
 * What the audit log keeps of a purged employee document (#923). A purge
 * removes the document's descriptions from every audit record about it: its
 * title, file name, ZIP entry name, the values of a title change and the
 * free-text reason. Identifiers, the action, the time, the category, the
 * document date, the pay period and the purge's retention facts stay, so the
 * record still says who did what to which document and when. Rows, ids and
 * timestamps are never touched, so the global audit-log lifetime still counts
 * from the original event. Minimising is idempotent: a minimised record is
 * returned unchanged.
 */

type Fields = Record<string, unknown>;

/** The stored JSON text of one audit record. */
export interface StoredAuditFields {
	changes: string | null;
	metadata: string | null;
}

export type AuditMinimisation =
	| { kind: "unchanged" }
	| { kind: "minimised"; changes: string | null; metadata: string | null }
	/** The stored JSON cannot be read, so its descriptions cannot be removed. */
	| { kind: "unprocessable"; reason: "invalid_json" };

/** Set on a record (or a ZIP entry) whose descriptions were removed. */
export const DESCRIPTIONS_REMOVED = "descriptionsRemoved";

const SNAPSHOT_DESCRIPTIONS = ["title", "fileName"] as const;
const METADATA_DESCRIPTIONS = ["fileName", "reason"] as const;
const CHANGED_DESCRIPTIONS = ["title", "fileName"] as const;
const ZIP_ENTRY_DESCRIPTIONS = ["title", "fileName", "entryName"] as const;
const REMOVED_CHANGE = { removed: true } as const;

function isFields(value: unknown): value is Fields {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Drops the named keys that hold a value; true when one was dropped. */
function dropDescriptions(fields: Fields, keys: readonly string[]): boolean {
	let removed = false;
	for (const key of keys) {
		if (fields[key] === undefined || fields[key] === null) continue;
		delete fields[key];
		removed = true;
	}
	return removed;
}

/**
 * The fields of a record about the purged document (entity `employee_document`)
 * without its descriptions. A changed title keeps `{ removed: true }` so the
 * history still shows that the title was edited.
 */
export function documentAuditWithoutDescriptions(input: {
	changes: Fields | null;
	metadata: Fields | null;
}): { changes: Fields | null; metadata: Fields | null; removed: boolean } {
	const changes = input.changes ? structuredClone(input.changes) : null;
	const metadata = input.metadata ? structuredClone(input.metadata) : null;
	let removed = false;
	if (metadata) {
		if (isFields(metadata.document)) {
			removed = dropDescriptions(metadata.document, SNAPSHOT_DESCRIPTIONS) || removed;
		}
		removed = dropDescriptions(metadata, METADATA_DESCRIPTIONS) || removed;
	}
	if (changes) {
		for (const key of CHANGED_DESCRIPTIONS) {
			const change = changes[key];
			if (change === undefined || (isFields(change) && change.removed === true)) continue;
			changes[key] = { ...REMOVED_CHANGE };
			removed = true;
		}
	}
	if (removed) {
		const marked = metadata ?? {};
		marked[DESCRIPTIONS_REMOVED] = true;
		return { changes, metadata: marked, removed };
	}
	return { changes, metadata, removed };
}

/**
 * The metadata of a personnel file ZIP record (download or abort) without the
 * descriptions of the purged documents. Other documents' entries stay as they
 * are; a purged entry keeps its id and structured fields.
 */
export function zipAuditWithoutDescriptions(
	input: Fields,
	purgedDocumentIds: ReadonlySet<string>,
): { metadata: Fields; removed: boolean } {
	const metadata = structuredClone(input);
	let removed = false;
	const minimiseEntry = (entry: unknown) => {
		if (!isFields(entry) || typeof entry.id !== "string" || !purgedDocumentIds.has(entry.id)) {
			return;
		}
		if (dropDescriptions(entry, ZIP_ENTRY_DESCRIPTIONS)) {
			entry[DESCRIPTIONS_REMOVED] = true;
			removed = true;
		}
	};
	if (Array.isArray(metadata.documents)) metadata.documents.forEach(minimiseEntry);
	minimiseEntry(metadata.failedDocument);
	return { metadata, removed };
}

function parseFields(text: string | null): Fields | null | undefined {
	if (text === null) return null;
	try {
		const parsed: unknown = JSON.parse(text);
		return isFields(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

const UNPROCESSABLE: AuditMinimisation = { kind: "unprocessable", reason: "invalid_json" };

/** A stored record about the purged document, minimised. */
export function minimiseDocumentAudit(record: StoredAuditFields): AuditMinimisation {
	const changes = parseFields(record.changes);
	const metadata = parseFields(record.metadata);
	if (changes === undefined || metadata === undefined) return UNPROCESSABLE;
	const result = documentAuditWithoutDescriptions({ changes, metadata });
	if (!result.removed) return { kind: "unchanged" };
	return {
		kind: "minimised",
		changes: result.changes ? JSON.stringify(result.changes) : null,
		metadata: result.metadata ? JSON.stringify(result.metadata) : null,
	};
}

/** A stored personnel file ZIP record, minimised for the purged documents. */
export function minimiseZipAudit(
	record: StoredAuditFields,
	purgedDocumentIds: ReadonlySet<string>,
): AuditMinimisation {
	const metadata = parseFields(record.metadata);
	if (metadata === undefined) return UNPROCESSABLE;
	if (metadata === null) return { kind: "unchanged" };
	const result = zipAuditWithoutDescriptions(metadata, purgedDocumentIds);
	if (!result.removed) return { kind: "unchanged" };
	return { kind: "minimised", changes: record.changes, metadata: JSON.stringify(result.metadata) };
}
