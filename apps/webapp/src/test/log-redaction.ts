import { DrizzleQueryError } from "drizzle-orm/errors";
import pino from "pino";
import { vi } from "vitest";
import { DatabaseError } from "@/lib/effect/errors";

type Serializer = (value: unknown) => unknown;

/**
 * A failed query as drizzle-orm reports it: the bound params sit in its message and in its
 * enumerable `params` field, and PostgreSQL's error is its `cause`.
 */
export function drizzleQueryFailure(query: string, params: unknown[]): DrizzleQueryError {
	const postgresError = Object.assign(new Error("value too long for type character varying"), {
		code: "22001",
	});
	return new DrizzleQueryError(query, params, postgresError);
}

/** A failed `DatabaseService.query` whose cause is a drizzle query failure binding `params`. */
export function databaseFailure(operation: string, params: unknown[]): DatabaseError {
	return new DatabaseError({
		message: `Database query failed: ${operation}`,
		operation,
		cause: drizzleQueryFailure(`insert into "${operation}" values ($1, $2)`, params),
	});
}

/**
 * A logged object as the app's pino logger writes it: every key its serializers know (`err`,
 * `error`) run through them, as pino does before writing the line. Assert on this string, not on
 * `JSON.stringify` of a mock's calls, which can't see an Error's non-enumerable message or cause.
 */
export async function serializedLog(logged: unknown): Promise<string> {
	const { logger } = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
	const serializers = (logger as unknown as Record<symbol, Record<string, Serializer>>)[
		pino.symbols.serializersSym
	];
	const entries = Object.entries(logged as Record<string, unknown>).map(([key, value]) => [
		key,
		serializers[key] ? serializers[key](value) : value,
	]);
	return JSON.stringify(Object.fromEntries(entries));
}
