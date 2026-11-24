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
import {
	Column,
	type DriverValueDecoder,
	is,
	noopDecoder,
	Placeholder,
	SQL,
	Table,
} from "drizzle-orm";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

type Reader = Pick<DatabaseClient, "select" | "query">;

/** A built query: Drizzle's select and relational query builders before they are awaited. */
interface BuiltQuery {
	toSQL(): { sql: string; params: unknown[] };
	execute(...placeholderValues: unknown[]): Promise<unknown>;
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

/** A stable number per decoder object, for one memoized reader. */
type DecoderIds = (decoder: object) => number;

function decoderIdsOf(): DecoderIds {
	const ids = new WeakMap<object, number>();
	let next = 0;
	return (decoder) => {
		let id = ids.get(decoder);
		if (id === undefined) {
			next += 1;
			id = next;
			ids.set(decoder, id);
		}
		return id;
	};
}

/** A query whose result mapping the key cannot describe exactly: it is not memoized. */
class Unkeyable extends Error {}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * The result shape a query maps its rows into: field names map rows by position, and each field's
 * decoder turns its driver value into the row's value. Two queries with the same SQL may still
 * return different keys or values. A decoder (a column, or what `.mapWith` set) is keyed by
 * identity: the schema's columns are shared, so selects of them are memoized; a decoder function
 * built anew per query is not, and such a read runs on its own.
 */
function shapeOf(fields: unknown, decoderIds: DecoderIds): unknown {
	// A schema table or column decodes the same way wherever it is selected.
	if (is(fields, Column)) return ["column", decoderIds(fields)];
	if (is(fields, Table)) return ["table", decoderIds(fields)];
	if (is(fields, SQL)) {
		// Set by `.mapWith`; Drizzle's typings keep it internal.
		const { decoder } = fields as unknown as { decoder: DriverValueDecoder<unknown, unknown> };
		if (decoder === noopDecoder) return "sql";
		// `.mapWith(fn)` wraps the function in a new object each time: key the function.
		const decode = decoder.mapFromDriverValue;
		return ["sql", decoderIds(typeof decode === "function" ? decode : decoder)];
	}
	if (is(fields, SQL.Aliased)) return ["aliased", shapeOf(fields.sql, decoderIds)];
	if (!isPlainObject(fields)) throw new Unkeyable();
	return Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [key, shapeOf(value, decoderIds)]),
	);
}

/**
 * The shape a relational query (`db.query.<table>.findMany(config)`) maps its rows into: the
 * columns and relations it selects and its extras' decoders. Its filters and order are in its SQL.
 * Extras given as a function cannot be inspected without building them: not memoized.
 */
function relationalShapeOf(config: unknown, decoderIds: DecoderIds): unknown {
	if (config === true || config === undefined) return config ?? null;
	if (!isPlainObject(config)) throw new Unkeyable();
	const { columns, with: relations, extras } = config;
	if (extras !== undefined && !isPlainObject(extras)) throw new Unkeyable();
	if (relations !== undefined && !isPlainObject(relations)) throw new Unkeyable();
	return {
		columns: columns ?? null,
		extras: extras === undefined ? null : shapeOf(extras, decoderIds),
		with: relations
			? Object.fromEntries(
					Object.entries(relations).map(([name, nested]) => [
						name,
						relationalShapeOf(nested, decoderIds),
					]),
				)
			: null,
	};
}

/** The cache key of a query, or null when it cannot be keyed exactly (then it is not memoized). */
function keyOf(query: BuiltQuery, decoderIds: DecoderIds): string | null {
	try {
		const { sql, params } = query.toSQL();
		// A placeholder takes its value at execution: only `execute(values)` runs it, unmemoized.
		if (params.some((param) => is(param, Placeholder))) return null;
		const internals = query as unknown as {
			config?: { fields?: unknown };
			mode?: unknown;
			tableConfig?: unknown;
		};
		const shape =
			internals.tableConfig !== undefined
				? relationalShapeOf(internals.config, decoderIds)
				: shapeOf(internals.config?.fields, decoderIds);
		return JSON.stringify(
			[query.constructor.name, internals.mode ?? null, shape, sql, params],
			(_key, value) => (typeof value === "bigint" ? `${value}n` : value),
		);
	} catch (error) {
		if (error instanceof Unkeyable) return null;
		throw error;
	}
}

/**
 * `db` for one request: reads with the same statement, parameters and result shape run once and
 * every caller gets its own copy of the rows. A read it cannot key exactly (a decoder built per
 * query, extras given as a function, a prepared statement's placeholders) runs on its own.
 * Everything else passes through.
 */
export function memoizedReader(db: Reader): Reader {
	const reads = new Map<string, Promise<unknown>>();
	const decoderIds = decoderIdsOf();

	const read = (query: BuiltQuery): Promise<unknown> => {
		const key = keyOf(query, decoderIds);
		if (key === null) return query.execute();
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
				if (property === "execute") {
					// Values for placeholders: run with them, as the query would.
					return (...placeholderValues: unknown[]) =>
						placeholderValues.length > 0 && placeholderValues[0] !== undefined
							? built.execute(...placeholderValues)
							: read(built);
				}
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
