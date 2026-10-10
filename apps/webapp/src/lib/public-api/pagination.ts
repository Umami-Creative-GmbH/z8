import { z } from "zod";
import { problem } from "./problem";

/**
 * Cursor pagination for every Public API list (#763). A cursor is opaque to
 * callers: it holds the sort key of the last row of a page, and the next page
 * starts after it, so walking the cursor returns every row exactly once even
 * while rows are added before the cursor.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const pageQueryShape = {
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_SIZE)
		.default(DEFAULT_PAGE_SIZE)
		.describe(`Rows per page, 1 to ${MAX_PAGE_SIZE}.`),
	cursor: z
		.string()
		.min(1)
		.max(1024)
		.optional()
		.describe("The `nextCursor` of the previous page. Omit it for the first page."),
};

export type CursorValue = string | number;

export function encodeCursor(values: readonly CursorValue[]): string {
	return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/** What each part of a list's sort key must be. */
export type CursorPart = "string" | "number" | "uuid" | "instant" | "date";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function matches(value: unknown, part: CursorPart): boolean {
	switch (part) {
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "string":
			return typeof value === "string";
		case "uuid":
			return typeof value === "string" && UUID.test(value);
		case "date":
			return typeof value === "string" && DATE.test(value);
		case "instant":
			return typeof value === "string" && !Number.isNaN(Date.parse(value));
	}
}

/** The sort key a cursor holds, or null when it is not a cursor of this list. */
export function decodeCursor(cursor: string, shape: readonly CursorPart[]): CursorValue[] | null {
	try {
		const values: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (!Array.isArray(values) || values.length !== shape.length) return null;
		return values.every((value, index) => matches(value, shape[index]))
			? (values as CursorValue[])
			: null;
	} catch {
		return null;
	}
}

export interface Page<T> {
	data: T[];
	nextCursor: string | null;
}

/**
 * Builds a page from `limit + 1` rows read in sort order: the extra row only
 * tells whether another page follows.
 */
export function pageOf<Row, T>(
	rows: readonly Row[],
	limit: number,
	toItem: (row: Row) => T,
	sortKey: (row: Row) => readonly CursorValue[],
): Page<T> {
	const pageRows = rows.slice(0, limit);
	const last = pageRows.at(-1);
	return {
		data: pageRows.map(toItem),
		nextCursor: rows.length > limit && last ? encodeCursor(sortKey(last)) : null,
	};
}

export const pageSchema = <T extends z.ZodType>(item: T) =>
	z.object({
		data: z.array(item),
		nextCursor: z
			.string()
			.nullable()
			.describe("Pass as `cursor` to read the next page; null on the last page."),
	});

/** The refusal for a cursor that was not issued by this list. */
export const invalidCursor = () =>
	({
		ok: false,
		problem: problem("validation_failed", {
			errors: [{ parameter: "cursor", message: "Not a cursor of this list" }],
		}),
	}) as const;
