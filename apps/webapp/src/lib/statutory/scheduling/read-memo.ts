/**
 * Load once, judge twice (#1934). A Staffing suggestion judges its candidates without and with the
 * proposed shift; only the proposal differs, while every monitor reads the same persisted shifts,
 * work, terms, offsets and acknowledgements over its lookback (for 200 Minijobbers some 70k rows).
 * The seam gives both runs one `memoizedReader`, so each distinct read runs once per request.
 *
 * Results stay identical by construction: a read is reused only for the same statement with the same
 * parameters and the same result shape, and every caller gets its own copy of the rows, so a
 * contributor that sorts or extends what it read cannot change what the other run sees. A read the
 * proposal changes (a range widened to reach it) simply runs again. Use it only where nothing is
 * written between the runs: the published-shift edit guard saves the shift between its two runs.
 */
import { Column, is, SQL } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

type Reader = Pick<DatabaseClient, "select" | "query">;

/** A built query: Drizzle's select and relational query builders before they are awaited. */
interface BuiltQuery {
	toSQL(): { sql: string; params: unknown[] };
	execute(): Promise<unknown>;
	then: unknown;
}

function isBuiltQuery(value: unknown): value is BuiltQuery {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as BuiltQuery).toSQL === "function" &&
		typeof (value as BuiltQuery).execute === "function" &&
		typeof (value as BuiltQuery).then === "function"
	);
}

/**
 * The result shape a select maps its rows into: field names map rows by position, so two selects
 * with the same SQL may still return different keys.
 */
function shapeOf(fields: unknown): unknown {
	if (typeof fields !== "object" || fields === null || is(fields, SQL) || is(fields, Column)) {
		return 1;
	}
	if (Object.getPrototypeOf(fields) !== Object.prototype) return 1;
	return Object.fromEntries(
		Object.entries(fields as Record<string, unknown>).map(([key, value]) => [key, shapeOf(value)]),
	);
}

function keyOf(query: BuiltQuery): string {
	const { sql, params } = query.toSQL();
	const internals = query as unknown as { config?: { fields?: unknown }; mode?: unknown };
	return JSON.stringify(
		[
			query.constructor.name,
			internals.mode ?? null,
			shapeOf(internals.config?.fields),
			sql,
			params,
		],
		(_key, value) => (typeof value === "bigint" ? `${value}n` : value),
	);
}

/**
 * `db` for one request: reads with the same statement, parameters and result shape run once and
 * every caller gets its own copy of the rows. Everything else passes through.
 */
export function memoizedReader(db: Reader): Reader {
	const reads = new Map<string, Promise<unknown>>();

	const read = (query: BuiltQuery): Promise<unknown> => {
		const key = keyOf(query);
		let pending = reads.get(key);
		if (!pending) {
			pending = query.execute();
			reads.set(key, pending);
			// A failed read is not kept: the next caller tries again.
			pending.catch(() => reads.delete(key));
		}
		return pending.then((rows) => structuredClone(rows));
	};

	const wrap = <T extends object>(query: T): T => {
		const proxy: T = new Proxy(query, {
			get(target, property) {
				const built = target as unknown as BuiltQuery;
				if (property === "then") {
					return (
						onFulfilled?: (value: unknown) => unknown,
						onRejected?: (reason: unknown) => unknown,
					) => read(built).then(onFulfilled, onRejected);
				}
				if (property === "catch") {
					return (onRejected?: (reason: unknown) => unknown) => read(built).catch(onRejected);
				}
				if (property === "finally") {
					return (onFinally?: () => void) => read(built).finally(onFinally);
				}
				if (property === "execute") return () => read(built);
				const value: unknown = Reflect.get(target, property, target);
				// Drizzle tells entities apart by their constructor (a query used as a subquery).
				if (typeof value !== "function" || property === "constructor") return value;
				return (...args: unknown[]) => {
					const result: unknown = value.apply(target, args);
					// Builder steps (`where`, `orderBy`…) return the builder or a new one.
					if (result === target) return proxy;
					return isBuiltQuery(result) ? wrap(result) : result;
				};
			},
		});
		return proxy;
	};

	/** `select(...)` returns a builder whose `from(...)` returns the query. */
	const wrapSelectBuilder = <T extends object>(builder: T): T =>
		new Proxy(builder, {
			get(target, property) {
				const value: unknown = Reflect.get(target, property, target);
				if (typeof value !== "function" || property === "constructor") return value;
				return (...args: unknown[]) => {
					const result: unknown = value.apply(target, args);
					return isBuiltQuery(result) ? wrap(result) : result;
				};
			},
		});

	const query = new Proxy(db.query, {
		get(tables, table) {
			const builder: unknown = Reflect.get(tables, table, tables);
			if (typeof builder !== "object" || builder === null) return builder;
			return new Proxy(builder, {
				get(target, method) {
					const value: unknown = Reflect.get(target, method, target);
					if (typeof value !== "function" || method === "constructor") return value;
					return (...args: unknown[]) => {
						const result: unknown = value.apply(target, args);
						return isBuiltQuery(result) ? wrap(result) : result;
					};
				},
			});
		},
	});

	return new Proxy(db, {
		get(target, property) {
			if (property === "query") return query;
			const value: unknown = Reflect.get(target, property, target);
			if (property !== "select" || typeof value !== "function") return value;
			return (...args: unknown[]) => wrapSelectBuilder(value.apply(target, args) as object);
		},
	});
}
