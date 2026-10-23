import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { withNativeSource } from "@/lib/typescript/native-source-analysis";

/**
 * Every view that answers "who works here now" filters with the current-roster
 * rule (#1438, Organization ADR 0006). Each surface is listed here by file and
 * function; the guard fails when one of them stops calling the rule or goes
 * back to a hand-written active check on the employee, which misses due
 * departures.
 *
 * Views of the past keep former employees on purpose and are listed apart, so
 * that the choice is visible and the entries can't silently rot.
 */

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The calls that apply the rule: the predicate itself or a reader built on it. */
const ROSTER_RULE = /\bonCurrentRoster\(|\bcurrentRoster[A-Z]\w*\(/;
/** A hand-written active check on the employee instead of the rule. */
const RAW_EMPLOYEE_ACTIVE_CHECK = /\bemployee\.isActive\b|"employee"\."is_active"|\bemployee\.is_active\b/;

type Surface = { file: string; functions: string[]; note: string };

export const ROSTER_SURFACES: Surface[] = [];

export const HISTORY_VIEWS: Surface[] = [];

/**
 * The bodies of the named functions in a source file: declarations, methods,
 * and functions or arrows assigned to a variable or an object property. A name
 * declared twice in one file maps to null, so the list must name it uniquely.
 */
export function functionBodies(source: string, fileName: string): Map<string, string | null> {
	return withNativeSource(source, fileName, ({ sourceFile }) => {
		const bodies = new Map<string, string | null>();
		const record = (name: string, body: ts.Node | undefined) => {
			if (!body) return;
			const text = source.slice(body.getStart(sourceFile), body.getEnd());
			bodies.set(name, bodies.has(name) ? null : text);
		};
		const functionLike = (node: ts.Node | undefined) =>
			node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : undefined;

		function visit(node: ts.Node) {
			if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
				if (ts.isIdentifier(node.name)) record(node.name.text, node.body);
			} else if (
				(ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
				ts.isIdentifier(node.name)
			) {
				const fn = functionLike(node.initializer);
				if (fn) record(node.name.text, fn.body);
			}
			node.forEachChild(visit);
		}

		visit(sourceFile);
		return bodies;
	});
}

export function rosterViolation(body: string): string | null {
	if (!ROSTER_RULE.test(body)) return "does not filter with the current-roster rule";
	if (RAW_EMPLOYEE_ACTIVE_CHECK.test(body)) return "uses a hand-written active check";
	return null;
}

const bodiesByFile = new Map<string, Map<string, string | null>>();

function bodyOf(file: string, fn: string): string | null | undefined {
	let bodies = bodiesByFile.get(file);
	if (!bodies) {
		bodies = functionBodies(readFileSync(join(SRC_ROOT, file), "utf8"), file);
		bodiesByFile.set(file, bodies);
	}
	return bodies.get(fn);
}

const entries = (surfaces: Surface[]) =>
	surfaces.flatMap((surface) => surface.functions.map((fn) => [surface.file, fn] as const));

describe("current-roster surface guard", () => {
	it.each([
		[
			"an unfiltered roster query",
			`async function listTeam(organizationId: string): Promise<{ id: string }[]> {
				return db.select().from(employee).where(eq(employee.organizationId, organizationId));
			}`,
			"does not filter with the current-roster rule",
		],
		[
			"a hand-written active check",
			`const listTeam = async ({ organizationId }: { organizationId: string }) => {
				return db.select().from(employee).where(and(eq(employee.isActive, true), onCurrentRoster(organizationId)));
			};`,
			"uses a hand-written active check",
		],
		[
			"a query filtered with the rule",
			`export async function listTeam(input: { organizationId: string }): Promise<{ id: string }[]> {
				return db.select().from(employee).where(and(onCurrentRoster(input.organizationId), eq(workPeriod.isActive, true)));
			}`,
			null,
		],
		[
			"a reader built on the rule",
			`const service = {
				listTeam: (organizationId: string) => currentRosterEmployeeIds(db, { organizationId }),
			};`,
			null,
		],
	] as const)("classifies %s", (_label, source, expected) => {
		const body = functionBodies(source, "/fixture.ts").get("listTeam");
		expect(body).toBeTruthy();
		expect(rosterViolation(body ?? "")).toBe(expected);
	});

	it("refuses a name declared twice in one file", () => {
		const bodies = functionBodies(
			`const a = { handler: () => onCurrentRoster("o") }; const b = { handler: () => 1 };`,
			"/fixture.ts",
		);
		expect(bodies.get("handler")).toBeNull();
	});

	it.each(entries(ROSTER_SURFACES))("%s %s filters with the current-roster rule", (file, fn) => {
		const body = bodyOf(file, fn);
		expect(body, `${fn} is missing or declared twice in ${file}`).toBeTruthy();
		expect(rosterViolation(body ?? "")).toBeNull();
	});

	it.each(entries(HISTORY_VIEWS))("%s %s still exists as a listed view of the past", (file, fn) => {
		expect(bodyOf(file, fn), `${fn} is missing or declared twice in ${file}`).toBeTruthy();
	});
});
