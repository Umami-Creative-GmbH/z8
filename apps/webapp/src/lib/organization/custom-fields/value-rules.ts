/**
 * Rules for custom field values (#818, spec #769): what a value of each field
 * type may be, and how a form draft becomes a value. Pure and client-safe; the
 * store (`values.ts`) applies the rules that need the database (record reach,
 * archived fields, edit level, required fields).
 */

import {
	CUSTOM_FIELD_TEXT_MAX_LENGTH,
	type CustomFieldNumberSettings,
	type CustomFieldType,
} from "./definition-rules";

/**
 * A custom field value. `number` is a canonical decimal string ("-1.5"),
 * `date` a plain calendar date ("2024-02-29"), `select` an option id.
 */
export type CustomFieldValue =
	| { type: "text"; value: string }
	| { type: "number"; value: string }
	| { type: "date"; value: string }
	| { type: "boolean"; value: boolean }
	| { type: "select"; value: string };

/**
 * What a form sends for one field: a string (text, number with "," or ".",
 * YYYY-MM-DD date, select option id), a boolean, or null / "" to clear.
 */
export type CustomFieldValueInput = string | boolean | null;

/** Values a form sends, by field id. Fields left out keep their value. */
export type CustomFieldValuesInput = Record<string, CustomFieldValueInput>;

export type CustomFieldValueRefusal =
	| "invalid_value"
	| "text_too_long"
	| "invalid_number"
	| "number_not_integer"
	| "number_out_of_range"
	| "invalid_date"
	| "invalid_option"
	| "option_archived";

/** What the value rules need to know about a field. */
export interface CustomFieldValueField {
	id: string;
	type: CustomFieldType;
	number: CustomFieldNumberSettings | null;
	options: readonly { id: string; archived: boolean }[];
}

export type ParsedCustomFieldValue =
	| { ok: true; value: CustomFieldValue | null }
	| { ok: false; reason: CustomFieldValueRefusal };

const DECIMAL = /^(-?)(\d{1,15})(?:[.,](\d{1,6}))?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function refuse(reason: CustomFieldValueRefusal): ParsedCustomFieldValue {
	return { ok: false, reason };
}

/** A canonical decimal string: no leading or trailing zeros, "." separator, no "-0". */
function canonicalDecimal(text: string): { value: string; fractional: boolean } | null {
	const match = DECIMAL.exec(text);
	if (!match) return null;
	const integer = match[2].replace(/^0+(?=\d)/, "");
	const fraction = (match[3] ?? "").replace(/0+$/, "");
	const sign = integer === "0" && fraction === "" ? "" : match[1];
	return {
		value: `${sign}${integer}${fraction ? `.${fraction}` : ""}`,
		fractional: fraction !== "",
	};
}

/** Compares two canonical decimal strings exactly (no floating point). */
export function compareCanonicalDecimals(left: string, right: string): number {
	const negativeLeft = left.startsWith("-");
	const negativeRight = right.startsWith("-");
	if (negativeLeft !== negativeRight) return negativeLeft ? -1 : 1;
	const magnitude = compareMagnitudes(left.replace(/^-/, ""), right.replace(/^-/, ""));
	return negativeLeft ? -magnitude : magnitude;
}

function compareMagnitudes(left: string, right: string): number {
	const [leftInteger, leftFraction = ""] = left.split(".");
	const [rightInteger, rightFraction = ""] = right.split(".");
	if (leftInteger.length !== rightInteger.length) {
		return leftInteger.length < rightInteger.length ? -1 : 1;
	}
	const width = Math.max(leftFraction.length, rightFraction.length);
	const a = leftInteger + leftFraction.padEnd(width, "0");
	const b = rightInteger + rightFraction.padEnd(width, "0");
	return a === b ? 0 : a < b ? -1 : 1;
}

function isCalendarDate(text: string): boolean {
	const match = ISO_DATE.exec(text);
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (month < 1 || month > 12 || day < 1) return false;
	const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return day <= days;
}

function parseNumber(field: CustomFieldValueField, text: string): ParsedCustomFieldValue {
	const decimal = canonicalDecimal(text);
	if (!decimal) return refuse("invalid_number");
	const settings = field.number;
	if (settings?.integerOnly && decimal.fractional) return refuse("number_not_integer");
	if (settings?.min != null && compareCanonicalDecimals(decimal.value, settings.min) < 0) {
		return refuse("number_out_of_range");
	}
	if (settings?.max != null && compareCanonicalDecimals(decimal.value, settings.max) > 0) {
		return refuse("number_out_of_range");
	}
	return { ok: true, value: { type: "number", value: decimal.value } };
}

function parseOption(
	field: CustomFieldValueField,
	optionId: string,
	current: CustomFieldValue | null,
): ParsedCustomFieldValue {
	const option = field.options.find((candidate) => candidate.id === optionId);
	if (!option) return refuse("invalid_option");
	// An archived option can't be chosen anew, but a record keeps the one it holds.
	const kept = current?.type === "select" && current.value === optionId;
	if (option.archived && !kept) return refuse("option_archived");
	return { ok: true, value: { type: "select", value: optionId } };
}

/**
 * Checks one form input against its field's type rules. `current` is the value
 * the record holds now; it lets the record keep an archived select option.
 */
export function parseCustomFieldValueInput(
	field: CustomFieldValueField,
	input: unknown,
	current: CustomFieldValue | null = null,
): ParsedCustomFieldValue {
	if (input === null || input === undefined) return { ok: true, value: null };
	if (field.type === "boolean") {
		return typeof input === "boolean"
			? { ok: true, value: { type: "boolean", value: input } }
			: refuse("invalid_value");
	}
	if (typeof input !== "string") return refuse("invalid_value");
	const text = input.trim();
	if (text === "") return { ok: true, value: null };

	switch (field.type) {
		case "text":
			return text.length <= CUSTOM_FIELD_TEXT_MAX_LENGTH
				? { ok: true, value: { type: "text", value: text } }
				: refuse("text_too_long");
		case "number":
			return parseNumber(field, text);
		case "date":
			return isCalendarDate(text)
				? { ok: true, value: { type: "date", value: text } }
				: refuse("invalid_date");
		case "select":
			return parseOption(field, text, current);
	}
}

/** Whether two values are the same (both null counts as the same). */
export function sameCustomFieldValue(
	left: CustomFieldValue | null,
	right: CustomFieldValue | null,
): boolean {
	if (left === null || right === null) return left === right;
	return left.type === right.type && left.value === right.value;
}

/** The form draft of a value: every type as a string, "" for no value. */
export function customFieldDraftOf(value: CustomFieldValue | null): string {
	if (value === null) return "";
	return typeof value.value === "boolean" ? String(value.value) : value.value;
}

/** The input a form sends for a draft of a field of `type`. */
export function customFieldInputOfDraft(
	type: CustomFieldType,
	draft: string,
): CustomFieldValueInput {
	if (draft.trim() === "") return null;
	if (type === "boolean") return draft === "true";
	return draft;
}

/** Ids of the required fields that have no value, in field order. */
export function missingRequiredCustomFieldIds(
	fields: readonly { id: string; required: boolean }[],
	values: Readonly<Record<string, CustomFieldValue | null | undefined>>,
): string[] {
	return fields.filter((field) => field.required && !values[field.id]).map((field) => field.id);
}
