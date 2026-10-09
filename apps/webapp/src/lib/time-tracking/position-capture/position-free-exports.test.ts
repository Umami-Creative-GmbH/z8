import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Payroll, GoBD audit, works-council and analytics exports never contain
 * positions (#835, spec #766). Only the org data export may, and only for a
 * permitted requester. This guard follows every runtime import (type-only
 * imports carry no data) from each of those export surfaces and fails when
 * one reaches a module that returns position stamps. Direct reads of the
 * `position_stamp` table are guarded by `position-stamp-readers.test.ts`.
 */
const SOURCE_ROOT = path.resolve(__dirname, "../../..");

const POSITION_SOURCES = [
	"lib/time-tracking/position-capture/stamps.ts",
	"lib/time-tracking/position-capture/work-period-positions.ts",
	"lib/time-tracking/position-capture/export-positions.ts",
	"lib/export/data-fetchers.ts",
];

const POSITION_FREE_EXPORTS: Record<string, string[]> = {
	payroll: [
		"lib/payroll-export",
		"lib/payroll-collection",
		"app/[locale]/(app)/payroll",
		"app/[locale]/(app)/settings/payroll-export",
		"components/settings/payroll-export",
		"lib/scheduled-exports/application/executors/payroll-export-executor.ts",
	],
	"GoBD audit": [
		"lib/audit-export",
		"lib/audit-pack",
		"app/api/audit-export",
		"app/[locale]/(app)/settings/audit-export",
		"components/settings/audit-export",
		"lib/scheduled-exports/application/executors/audit-report-executor.ts",
	],
	"works council": [
		"lib/works-council",
		"app/[locale]/(app)/works-council",
		"components/works-council",
	],
	analytics: [
		"lib/analytics",
		"lib/reports",
		"app/api/analytics",
		"app/[locale]/(app)/analytics",
		"app/[locale]/(app)/reports",
		"components/analytics",
	],
};

const IMPORT_PATTERNS = [
	// import x from "y", import { a, type b } from "y", export { a } from "y", export * from "y"
	/(?:^|[\s;])(?:import|export)\s+(?!type\b)[^'";]*?\sfrom\s+["']([^"']+)["']/g,
	// import "y"
	/(?:^|[\s;])import\s+["']([^"']+)["']/g,
	// await import("y")
	/\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function isSource(file: string) {
	return /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file);
}

function sourceFiles(entry: string): string[] {
	if (!statSync(entry).isDirectory()) return isSource(entry) ? [entry] : [];
	return readdirSync(entry).flatMap((name) => sourceFiles(path.join(entry, name)));
}

function resolveImport(from: string, specifier: string): string | null {
	let base: string;
	if (specifier.startsWith("@/")) base = path.join(SOURCE_ROOT, specifier.slice(2));
	else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
	else return null;
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		path.join(base, "index.ts"),
		path.join(base, "index.tsx"),
	]) {
		if (existsSync(candidate) && statSync(candidate).isFile() && isSource(candidate)) {
			return candidate;
		}
	}
	return null;
}

const importCache = new Map<string, string[]>();
function importsOf(file: string): string[] {
	const cached = importCache.get(file);
	if (cached) return cached;
	const text = readFileSync(file, "utf8");
	const resolved = new Set<string>();
	for (const pattern of IMPORT_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const target = match[1] ? resolveImport(file, match[1]) : null;
			if (target) resolved.add(target);
		}
	}
	const list = [...resolved];
	importCache.set(file, list);
	return list;
}

function relative(file: string) {
	return path.relative(SOURCE_ROOT, file).split(path.sep).join("/");
}

/** Every import chain from the roots that reaches one of the targets. */
function chainsTo(roots: readonly string[], targets: readonly string[]): string[] {
	const wanted = new Set(targets.map((target) => path.join(SOURCE_ROOT, target)));
	const parent = new Map<string, string | null>();
	const queue: string[] = [];
	for (const root of roots) {
		const full = path.join(SOURCE_ROOT, root);
		expect(existsSync(full), `export surface ${root} no longer exists`).toBe(true);
		for (const file of sourceFiles(full)) {
			if (!parent.has(file)) {
				parent.set(file, null);
				queue.push(file);
			}
		}
	}
	const chains: string[] = [];
	for (let index = 0; index < queue.length; index++) {
		const file = queue[index] as string;
		if (wanted.has(file)) {
			const chain: string[] = [];
			for (let at: string | null | undefined = file; at; at = parent.get(at)) {
				chain.unshift(relative(at));
			}
			chains.push(chain.join(" -> "));
			continue;
		}
		for (const next of importsOf(file)) {
			if (parent.has(next)) continue;
			parent.set(next, file);
			queue.push(next);
		}
	}
	return chains;
}

describe("exports that never contain positions", () => {
	it("follows imports to the position sources (control: the org data export reaches them)", () => {
		expect(chainsTo(["app/[locale]/(app)/settings/export"], POSITION_SOURCES)).toContainEqual(
			expect.stringContaining("lib/export/data-fetchers.ts"),
		);
	});

	for (const [surface, roots] of Object.entries(POSITION_FREE_EXPORTS)) {
		it(`${surface} exports reach no module that returns position stamps`, () => {
			expect(chainsTo(roots, POSITION_SOURCES)).toEqual([]);
		});
	}
});
