import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every view that answers "who works here now" filters with the current-roster
 * rule (#1438, Organization ADR 0006). Each surface is listed here by file and
 * function; the guard fails when one of them stops calling the rule or goes
 * back to a hand-written active check, which misses due departures.
 *
 * Views of the past keep former employees on purpose and are listed apart, so
 * that the choice is visible and the entries can't silently rot.
 */

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The calls that apply the rule: the predicate itself or a reader built on it. */
const ROSTER_RULE = /\bonCurrentRoster\(|\bcurrentRoster[A-Z]\w*\(/;
/** A hand-written active check instead of the rule. */
const RAW_ACTIVE_CHECK =
	/\bisActive\s*,\s*true\b|\bis_active"?\s*=\s*true\b|\bisActive\s*===?\s*true\b|\.isActive\)/;

type Surface = { file: string; functions: string[]; note: string };

export const ROSTER_SURFACES: Surface[] = [];

export const HISTORY_VIEWS: Surface[] = [];

/**
 * The body of a function, method or arrow assigned to `name`, by matching its
 * braces. Strings and comments are skipped so that braces inside them don't count.
 */
export function functionBody(source: string, name: string): string | null {
	const declaration = new RegExp(
		String.raw`(?:function\s+${name}\s*[<(]|\b${name}\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)|\b${name}\s*\([^)]*\)\s*(?::[^{]+)?\{)`,
	);
	const match = declaration.exec(source);
	if (!match) return null;
	const open = source.indexOf("{", match.index + match[0].length - 1);
	if (open < 0) return null;
	let depth = 0;
	for (let index = open; index < source.length; index++) {
		const char = source[index];
		if (char === '"' || char === "'" || char === "`") {
			index = skipString(source, index, char);
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			index = source.indexOf("\n", index);
			if (index < 0) return null;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			index = source.indexOf("*/", index) + 1;
			continue;
		}
		if (char === "{") depth++;
		if (char === "}") {
			depth--;
			if (depth === 0) return source.slice(open, index + 1);
		}
	}
	return null;
}

function skipString(source: string, start: number, quote: string): number {
	for (let index = start + 1; index < source.length; index++) {
		if (source[index] === "\\") {
			index++;
			continue;
		}
		if (quote === "`" && source[index] === "$" && source[index + 1] === "{") {
			// Template expressions may hold braces; skip to their matching close.
			let depth = 0;
			for (index++; index < source.length; index++) {
				if (source[index] === "{") depth++;
				if (source[index] === "}" && --depth === 0) break;
			}
			continue;
		}
		if (source[index] === quote) return index;
	}
	return source.length;
}

export function rosterViolation(body: string): string | null {
	if (!ROSTER_RULE.test(body)) return "does not filter with the current-roster rule";
	if (RAW_ACTIVE_CHECK.test(body)) return "uses a hand-written active check";
	return null;
}

const read = (file: string) => readFileSync(join(SRC_ROOT, file), "utf8");

describe("current-roster surface guard", () => {
	it.each([
		[
			"an unfiltered roster query",
			`async function listTeam(organizationId) {
				return db.select().from(employee).where(eq(employee.organizationId, organizationId));
			}`,
			"does not filter with the current-roster rule",
		],
		[
			"a hand-written active check",
			`const listTeam = async (organizationId: string) => {
				return db.select().from(employee).where(and(eq(employee.isActive, true), onCurrentRoster(organizationId)));
			};`,
			"uses a hand-written active check",
		],
		[
			"a query filtered with the rule",
			`export async function listTeam(organizationId: string): Promise<Row[]> {
				const label = "}";
				return db.select().from(employee).where(onCurrentRoster(organizationId));
			}`,
			null,
		],
		[
			"a reader built on the rule",
			`listTeam: (organizationId) => {
				return currentRosterEmployeeIds(db, { organizationId });
			},`,
			null,
		],
	] as const)("classifies %s", (_label, source, expected) => {
		const body = functionBody(source, "listTeam");
		expect(body).not.toBeNull();
		expect(rosterViolation(body ?? "")).toBe(expected);
	});

	it.each(ROSTER_SURFACES.flatMap((surface) => surface.functions.map((fn) => [surface.file, fn])))(
		"%s %s filters with the current-roster rule",
		(file, fn) => {
			const body = functionBody(read(file), fn);
			expect(body, `${fn} not found in ${file}`).not.toBeNull();
			expect(rosterViolation(body ?? "")).toBeNull();
		},
	);

	it.each(HISTORY_VIEWS.flatMap((surface) => surface.functions.map((fn) => [surface.file, fn])))(
		"%s %s still exists as a listed view of the past",
		(file, fn) => {
			expect(functionBody(read(file), fn), `${fn} not found in ${file}`).not.toBeNull();
		},
	);
});
