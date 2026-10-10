import { z } from "zod";

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

/** The sort key a cursor holds, or null when it is not a cursor of this list. */
export function decodeCursor(
	cursor: string,
	shape: readonly ("string" | "number")[],
): CursorValue[] | null {
	try {
		const values: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (!Array.isArray(values) || values.length !== shape.length) return null;
		return values.every((value, index) => typeof value === shape[index])
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
