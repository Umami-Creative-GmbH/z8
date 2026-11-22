import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const APP_SEGMENT_ROOT = fileURLToPath(new URL(".", import.meta.url));

const ROUTE_ENDPOINT_FILES = new Set(["page.tsx", "page.ts", "route.ts", "route.tsx"]);
const PAGE_FILES = new Set(["page.tsx", "page.ts"]);
const COLOCATED_HELPER_DIRS = new Set(["actions", "components"]);
const CODE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const TEST_OR_DECLARATION_FILE_PATTERN = /(?:\.(?:test|spec|typecheck)\.[cm]?[jt]sx?|\.d\.ts)$/;

function isRuntimeCodeFile(fileName: string): boolean {
	return CODE_FILE_PATTERN.test(fileName) && !TEST_OR_DECLARATION_FILE_PATTERN.test(fileName);
}

function hasDirectFile(dirPath: string, names: ReadonlySet<string>): boolean {
	for (const name of names) {
		if (existsSync(join(dirPath, name))) {
			return true;
		}
	}
	return false;
}

function hasRouteInSubtree(dirPath: string): boolean {
	const entries = readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isFile() && ROUTE_ENDPOINT_FILES.has(entry.name)) {
			return true;
		}
	}
	for (const entry of entries) {
		if (
			entry.isDirectory() &&
			entry.name !== "__tests__" &&
			hasRouteInSubtree(join(dirPath, entry.name))
		) {
			return true;
		}
	}
	return false;
}

function isColocatedHelperAlongsidePage(
	dirName: string,
	parentDir: string,
	depth: number,
): boolean {
	if (depth < 2) {
		return false;
	}
	const isAllowedHelperName = COLOCATED_HELPER_DIRS.has(dirName) || dirName.startsWith("_");
	return isAllowedHelperName && hasDirectFile(parentDir, PAGE_FILES);
}

/**
 * Returns relative paths of directories under `appRoot` that contain runtime
 * code without owning or descending toward a routed page/route handler and
 * without being a route-colocated helper folder (`actions`, `components`, or
 * `_`-prefixed private folder) directly alongside a routed page.
 *
 * Test-only directories (such as `__tests__` or directories containing only
 * test files) are excluded.
 */
function findPagelessAppRouteDirectories(appRoot: string): string[] {
	const offenders: string[] = [];

	function walk(currentDir: string, depth: number) {
		const entries = readdirSync(currentDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === "__tests__") {
				continue;
			}

			const childDir = join(currentDir, entry.name);
			const childDepth = depth + 1;

			if (isColocatedHelperAlongsidePage(entry.name, currentDir, childDepth)) {
				continue;
			}

			if (hasRouteInSubtree(childDir)) {
				walk(childDir, childDepth);
				continue;
			}

			const childEntries = readdirSync(childDir, { withFileTypes: true });
			const hasDirectRuntimeCode = childEntries.some(
				(childEntry) => childEntry.isFile() && isRuntimeCodeFile(childEntry.name),
			);

			if (hasDirectRuntimeCode) {
				offenders.push(relative(appRoot, childDir).split(sep).join("/"));
			}

			walk(childDir, childDepth);
		}
	}

	walk(appRoot, 0);
	return offenders.sort();
}

describe("authenticated app route-structure guard", () => {
	const tempRoots: string[] = [];

	afterEach(() => {
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	function createFixtureTree(files: readonly string[]): string {
		const root = mkdtempSync(join(tmpdir(), "z8-app-route-guard-"));
		tempRoots.push(root);

		for (const relativeFile of files) {
			const fullPath = join(root, relativeFile);
			mkdirSync(join(fullPath, ".."), { recursive: true });
			writeFileSync(fullPath, "// fixture\n", "utf8");
		}

		return root;
	}

	it("rejects top-level and nested page-less code folders while allowing routed pages, colocated helpers, and test-only folders", () => {
		const fixtureRoot = createFixtureTree([
			"page.tsx",
			// Valid routed segments and intermediate directories
			"billing/layout.tsx",
			"billing/suspended/page.tsx",
			"works-council/export/route.ts",
			"approvals/inbox/page.tsx",
			"approvals/inbox/components/panel.tsx",
			"scheduling/page.tsx",
			"scheduling/actions/shift-actions.ts",
			"settings/page.tsx",
			"settings/__tests__/settings-route-access.test.ts",
			"analytics/page.tsx",
			"analytics/only-tests/helper.test.ts",
			// Invalid page-less folders
			"search/actions.ts",
			"actions/orphan.ts",
			"wellness/actions.ts",
			"wellness/actions/queries.ts",
			"settings/orphan-feature/actions.ts",
			"billing/actions/helper.ts",
		]);

		expect(findPagelessAppRouteDirectories(fixtureRoot)).toEqual([
			"actions",
			"billing/actions",
			"search",
			"settings/orphan-feature",
			"wellness",
			"wellness/actions",
		]);
	});

	it("ensures every directory under src/app/[locale]/(app) owns or descends toward a routed page or is a route-colocated helper alongside a page", () => {
		expect(
			findPagelessAppRouteDirectories(APP_SEGMENT_ROOT),
			"Move page-less server actions and helpers into domain modules under src/lib/ instead of keeping them inside src/app/[locale]/(app)/.",
		).toEqual([]);
	});
});
