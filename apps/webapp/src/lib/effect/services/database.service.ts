import { trace } from "@opentelemetry/api";
import { Context, Effect, Layer } from "effect";
import { db } from "@/db";
import { DatabaseError } from "../errors";

export class DatabaseService extends Context.Tag("DatabaseService")<
	DatabaseService,
	{
		readonly db: typeof db;
		readonly query: <T>(name: string, fn: () => Promise<T>) => Effect.Effect<T, DatabaseError>;
	}
>() {}

export const DatabaseServiceLive = Layer.succeed(
	DatabaseService,
	DatabaseService.of({
		db,
		query: (name, fn) =>
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
			}),
	}),
);
