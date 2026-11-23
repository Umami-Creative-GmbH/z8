/**
 * An error as a log may name it when the failure may carry user-written text: its name, tag,
 * code, operation, the database identifiers it hit and its stack frames, never a message,
 * cause or bound params.
 *
 * Log this instead of the raw error wherever a failed query bound free text (a reason, a note):
 * drizzle-orm's `DrizzleQueryError` writes every param into its message and an enumerable
 * `params` field, `DatabaseError` keeps it as `cause`, and pino's error serializer adds every
 * cause's message and stack to the logged line.
 */
export interface ErrorLogSummary {
	name: string;
	errorTag?: string;
	/** The first code along the cause chain, such as PostgreSQL's SQLSTATE. */
	code?: string;
	/** The failed `DatabaseService.query`'s name. */
	operation?: string;
	/** The constraint, table and column PostgreSQL names for the failure, along the cause chain. */
	constraint?: string;
	table?: string;
	column?: string;
	/** Where it was thrown: the stack's frames, without its header (the message). */
	frames?: string[];
}

const MAX_FRAMES = 20;

/** A code location: a script file, a `node:` module or an eval'd `<anonymous>`, at `:line:col`. */
const LOCATION = String.raw`(?:\S+\.[cm]?[jt]sx?|node:[a-z][\w./-]*|<anonymous>):\d+:\d+`;
/**
 * `[async ][new ][Type.][get |set ]name[ [as alias]]`, e.g. `Object.get broken [as broken]`;
 * names with spaces (computed keys) are not kept.
 */
const CALLEE = String.raw`(?:async )?(?:new )?(?:(?:\S+\.)?(?:get|set) )?\S+(?: \[as \S+\])?`;
/**
 * Where a call ran: a location, `<anonymous>`, `native`, `index N` (`Promise.all`'s element), or
 * an eval with where it was made.
 */
const CALL_SITE = String.raw`${LOCATION}|<anonymous>|native|index \d+|eval at \S+ \(${LOCATION}\), ${LOCATION}`;

/**
 * A V8 stack frame: `at callee (site)` or `at [async ]location`. Free text after "at ", even a
 * time like `08:30:00`, is not one: its location must name code, not just end in `:n:n`.
 */
const V8_FRAME = new RegExp(
	String.raw`^at (?:${CALLEE} \((?:${CALL_SITE})\)|(?:async )?${LOCATION})$`,
);

/**
 * The stack's real frames only. A frame-shaped line is kept only if it is shaped like a V8
 * frame and is not part of the current message, so neither a message changed after the stack
 * was taken, nor a `toString` or `.stack` override, can bring message text along.
 */
function stackFrames(error: Error): string[] | undefined {
	const stack = error.stack;
	if (typeof stack !== "string") return undefined;
	const message = typeof error.message === "string" ? error.message : "";
	const frames = stack
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => V8_FRAME.test(line) && !message.includes(line))
		.slice(0, MAX_FRAMES);
	return frames.length > 0 ? frames : undefined;
}

const MAX_CAUSE_DEPTH = 8;
const IDENTIFIER = /^[\w.:-]{1,80}$/;

function identifier(value: unknown): string | undefined {
	return typeof value === "string" && IDENTIFIER.test(value) ? value : undefined;
}

function property(error: unknown, key: string): unknown {
	return error !== null && typeof error === "object"
		? (error as Record<string, unknown>)[key]
		: undefined;
}

/** An Error's name, or its class's when the name is the generic "Error" (DrizzleQueryError's is). */
function errorName(error: Error): string {
	const name = identifier(error.name) ?? "Error";
	return name === "Error" ? (identifier(error.constructor?.name) ?? name) : name;
}

export function errorLogSummary(error: unknown): ErrorLogSummary {
	const summary: ErrorLogSummary = {
		name: error instanceof Error ? errorName(error) : typeof error,
		...(error instanceof Error ? { frames: stackFrames(error) } : {}),
	};
	const seen = new Set<unknown>();
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && !seen.has(current); depth++) {
		seen.add(current);
		summary.errorTag ??= identifier(property(current, "_tag"));
		summary.code ??= identifier(property(current, "code"));
		summary.operation ??= identifier(property(current, "operation"));
		summary.constraint ??= identifier(property(current, "constraint"));
		summary.table ??= identifier(property(current, "table"));
		summary.column ??= identifier(property(current, "column"));
		current = property(current, "cause");
	}
	return Object.fromEntries(
		Object.entries(summary).filter(([, value]) => value !== undefined),
	) as ErrorLogSummary;
}
