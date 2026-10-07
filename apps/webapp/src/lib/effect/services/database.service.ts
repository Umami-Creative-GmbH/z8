import { trace } from "@opentelemetry/api";
import { Context, Effect, Layer } from "effect";
import { db } from "@/db";
import { DatabaseError } from "../errors";

/** The global Drizzle database. A transaction stands in for it in a transaction-bound service. */
export type DatabaseClient = typeof db;

/**
 * Runs database work in a `db.query.<name>` span and maps a rejection to
 * `DatabaseError { operation: name, cause }`. Name queries `<area>.<operation>`.
 */
export type DatabaseQuery = <T>(
	name: string,
	fn: () => Promise<T>,
) => Effect.Effect<T, DatabaseError>;

export class DatabaseService extends Context.Service<
	DatabaseService,
	{
		readonly db: DatabaseClient;
		readonly query: DatabaseQuery;
	}
>()("DatabaseService") {}

const query: DatabaseQuery = (name, fn) =>
	Effect.tryPromise({
		try: async () => {
			const tracer = trace.getTracer("database");
			return await tracer.startActiveSpan(`db.query.${name}`, async (span) => {
				try {
					const result = await fn();
					span.setStatus({ code: 1 }); // OK
					return result;
				} catch (error) {
					span.recordException(error as Error);
					span.setStatus({ code: 2, message: String(error) }); // ERROR
					throw error;
				} finally {
					span.end();
				}
			});
		},
		catch: (error) =>
			new DatabaseError({
				message: `Database query failed: ${name}`,
				operation: name,
				cause: error,
			}),
	});

/**
 * The one way to build a database service: over the global database, or bound to a
 * transaction (`makeDatabaseService(tx)`). Every instance gets the same tracing and
 * `DatabaseError` mapping.
 */
export function makeDatabaseService<Client = DatabaseClient>(
	database: Client,
): { readonly db: Client; readonly query: DatabaseQuery } {
	return { db: database, query };
}

export const DatabaseServiceLive = Layer.succeed(
	DatabaseService,
	DatabaseService.of(makeDatabaseService(db)),
);
