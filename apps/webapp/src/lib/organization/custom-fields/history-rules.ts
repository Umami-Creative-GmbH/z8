/**
 * Rules for tracked custom fields (#819, spec #769): a tracked field keeps a
 * dated history of values, each valid from a plain calendar date (the
 * organization's business date) until the next one starts. Pure and
 * client-safe; the store (`values.ts`) applies them inside the save.
 */

import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type CustomFieldValue,
	type CustomFieldValueField,
	type CustomFieldValueInput,
	type CustomFieldValueRefusal,
	parseCustomFieldValueInput,
	sameCustomFieldValue,
} from "./value-rules";

/** One dated value of a tracked field. `validFrom` is a "YYYY-MM-DD" plain date. */
export interface CustomFieldHistoryEntry {
	id: string;
	validFrom: string;
	value: CustomFieldValue;
}

/**
 * The value as of `asOf`: the entry with the latest valid-from on or before
 * that date. Null when every entry starts later (or there is none).
 */
export function customFieldValueAsOf(
	entries: readonly Pick<CustomFieldHistoryEntry, "validFrom" | "value">[],
	asOf: PlainDate,
): CustomFieldValue | null {
	let latest: { validFrom: PlainDate; value: CustomFieldValue } | null = null;
	for (const entry of entries) {
		const validFrom = parsePlainDate(entry.validFrom);
		if (comparePlainDates(validFrom, asOf) > 0) continue;
		if (latest === null || comparePlainDates(validFrom, latest.validFrom) > 0) {
			latest = { validFrom, value: entry.value };
		}
	}
	return latest?.value ?? null;
}

/**
 * One change to a tracked field's history, as a form sends it. `value` is a
 * value input like an untracked field's (see `CustomFieldValueInput`); a dated
 * entry always needs a value, since a value lasts until the next one starts.
 */
export type CustomFieldHistoryChange =
	| { op: "add"; validFrom: string; value: CustomFieldValueInput }
	| { op: "correct"; entryId: string; validFrom: string; value: CustomFieldValueInput }
	| { op: "delete"; entryId: string };

/** What a form sends for a tracked field (in place of a plain value). */
export interface CustomFieldHistoryInput {
	history: CustomFieldHistoryChange[];
}

export type CustomFieldHistoryRefusal =
	| CustomFieldValueRefusal
	/** Not a "YYYY-MM-DD" calendar date. */
	| "invalid_valid_from"
	/** Two entries of one record and field would share a valid-from date. */
	| "duplicate_valid_from"
	/** The entry is not (or no longer) in the record's history. */
	| "unknown_history_entry"
	/** A dated entry without a value. */
	| "missing_value";

/** A history entry after the changes; `id` null = added by them. */
export interface CustomFieldHistoryDraftEntry {
	id: string | null;
	validFrom: string;
	value: CustomFieldValue;
}

/** What the changes do, in the order they were given (the store writes and audits these). */
export type CustomFieldHistoryEffect =
	| { kind: "added"; after: { validFrom: string; value: CustomFieldValue } }
	| { kind: "corrected"; before: CustomFieldHistoryEntry; after: CustomFieldHistoryEntry }
	| { kind: "deleted"; before: CustomFieldHistoryEntry };

export type AppliedCustomFieldHistory =
	| { ok: true; entries: CustomFieldHistoryDraftEntry[]; effects: CustomFieldHistoryEffect[] }
	| { ok: false; reason: CustomFieldHistoryRefusal };

/** At most this many history changes per field and save. */
export const MAX_CUSTOM_FIELD_HISTORY_CHANGES = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function validFromOf(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	try {
		return parsePlainDate(raw).toString();
	} catch {
		return null;
	}
}

/** Newest valid-from first. */
export function newestFirst<T extends { validFrom: string }>(entries: readonly T[]): T[] {
	return [...entries].sort((left, right) =>
		comparePlainDates(parsePlainDate(right.validFrom), parsePlainDate(left.validFrom)),
	);
}

/**
 * Applies a form's history changes (`{ history: [...] }`) to a tracked field's
 * current entries of one record: adds (any valid-from date, past or future),
 * corrections of an entry's date or value, and deletions. Each entry may be
 * named once. Afterwards no two entries may share a valid-from date. Values
 * follow the field's type rules; a corrected entry keeps an archived select
 * option it already holds.
 */
export function applyCustomFieldHistoryChanges(
	field: CustomFieldValueField,
	entries: readonly CustomFieldHistoryEntry[],
	input: unknown,
): AppliedCustomFieldHistory {
	const refuse = (reason: CustomFieldHistoryRefusal) => ({ ok: false, reason }) as const;
	if (!isRecord(input) || !Array.isArray(input.history)) return refuse("invalid_value");
	if (input.history.length > MAX_CUSTOM_FIELD_HISTORY_CHANGES) return refuse("invalid_value");

	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const named = new Set<string>();
	const kept = new Map<string, CustomFieldHistoryDraftEntry>(
		entries.map((entry) => [entry.id, { ...entry }]),
	);
	const added: CustomFieldHistoryDraftEntry[] = [];
	const effects: CustomFieldHistoryEffect[] = [];

	for (const change of input.history) {
		if (!isRecord(change)) return refuse("invalid_value");
		if (change.op !== "add" && change.op !== "correct" && change.op !== "delete") {
			return refuse("invalid_value");
		}
		let before: CustomFieldHistoryEntry | null = null;
		if (change.op !== "add") {
			if (typeof change.entryId !== "string") return refuse("invalid_value");
			if (named.has(change.entryId)) return refuse("invalid_value");
			named.add(change.entryId);
			before = byId.get(change.entryId) ?? null;
			if (!before) return refuse("unknown_history_entry");
		}
		if (change.op === "delete" && before) {
			kept.delete(before.id);
			effects.push({ kind: "deleted", before });
			continue;
		}

		const validFrom = validFromOf(change.validFrom);
		if (!validFrom) return refuse("invalid_valid_from");
		const parsed = parseCustomFieldValueInput(field, change.value, before?.value ?? null);
		if (!parsed.ok) return refuse(parsed.reason);
		if (!parsed.value) return refuse("missing_value");
		const value = parsed.value;

		if (before) {
			const after = { id: before.id, validFrom, value };
			kept.set(before.id, after);
			if (before.validFrom !== validFrom || !sameCustomFieldValue(before.value, value)) {
				effects.push({ kind: "corrected", before, after });
			}
		} else {
			added.push({ id: null, validFrom, value });
			effects.push({ kind: "added", after: { validFrom, value } });
		}
	}

	const result = newestFirst([...kept.values(), ...added]);
	const dates = new Set(result.map((entry) => entry.validFrom));
	if (dates.size !== result.length) return refuse("duplicate_valid_from");
	return { ok: true, entries: result, effects };
}

/** The value input a history change sends for a value. */
function inputOf(value: CustomFieldValue): CustomFieldValueInput {
	return value.value;
}

/**
 * The changes that turn a tracked field's saved history into an edited list
 * (the form's draft): deletions of removed entries, corrections of changed
 * ones, then additions. Only differences are sent, so entries another user
 * adds meanwhile are kept.
 */
export function customFieldHistoryChangesOf(
	saved: readonly CustomFieldHistoryEntry[],
	edited: readonly { entryId: string | null; validFrom: string; value: CustomFieldValue }[],
): CustomFieldHistoryChange[] {
	const editedById = new Map(
		edited.flatMap((entry) => (entry.entryId ? [[entry.entryId, entry] as const] : [])),
	);
	const changes: CustomFieldHistoryChange[] = [];
	for (const entry of saved) {
		if (!editedById.has(entry.id)) changes.push({ op: "delete", entryId: entry.id });
	}
	for (const entry of saved) {
		const draft = editedById.get(entry.id);
		if (!draft) continue;
		if (draft.validFrom !== entry.validFrom || !sameCustomFieldValue(draft.value, entry.value)) {
			changes.push({
				op: "correct",
				entryId: entry.id,
				validFrom: draft.validFrom,
				value: inputOf(draft.value),
			});
		}
	}
	for (const entry of edited) {
		if (entry.entryId === null) {
			changes.push({ op: "add", validFrom: entry.validFrom, value: inputOf(entry.value) });
		}
	}
	return changes;
}
