/**
 * Every settings server action goes through `organizationAction` (ADR 0002,
 * #1592). This imports every settings `"use server"` module outside the
 * allowlist and fails on any exported function the module did not produce.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isOrganizationAction } from "@/lib/organization-action/organization-action";

const settingsDir = join(import.meta.dirname, "..");

/**
 * Settings folders not yet moved onto `organizationAction`. A folder slice of
 * #1592 removes its entries; the lock-in ticket empties this list.
 */
const NOT_YET_MIGRATED = [
	"avv",
	"billable-time",
	"calendar",
	"change-policies",
	"coverage-rules",
	"custom-fields",
	"customers",
	"email-templates",
	"employees",
	"enterprise",
	"holidays",
	"implementation-checklist",
	"kiosks",
	"locations",
	"my-data",
	"notification-channels",
	"notifications",
	"organization",
	"permissions",
	"personnel-files",
	"position-capture",
	"position-stamps",
	"profile",
	"projects",
	"security",
	"skills",
	"statistics",
	"surcharges",
	"teams",
	"travel-expenses",
	"vacation",
	"vehicle-use",
	"vehicles",
	"webhooks",
	"wellness",
	"work-categories",
	"work-policies",
];

/**
 * Account actions belong to no organization, so settings access does not
 * govern them (ADR 0002). Each permanent exemption names its export as
 * `<path under settings>#<export>` and gives the reason.
 */
const ACCOUNT_EXEMPTIONS: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
		return /\.tsx?$/.test(entry.name) && !/\.(test|typecheck)\.tsx?$/.test(entry.name)
			? [path]
			: [];
	});
}

/** A module-level directive: the first statement after any leading comments. */
function isUseServerModule(path: string): boolean {
	const source = readFileSync(path, "utf8").replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
	return /^["']use server["']/.test(source);
}

const settingsPath = (path: string) => relative(settingsDir, path).split(sep).join("/");
const folderOf = (path: string) => settingsPath(path).split("/")[0];

const useServerModules = sourceFiles(settingsDir).filter(isUseServerModule);
const coveredModules = useServerModules.filter(
	(path) => !NOT_YET_MIGRATED.includes(folderOf(path)),
);

describe("settings server actions go through organizationAction", () => {
	it("finds the settings server action modules", () => {
		expect(useServerModules.length).toBeGreaterThan(100);
		expect(coveredModules.length).toBeGreaterThan(0);
	});

	it.each(coveredModules.map((path) => [settingsPath(path), path]))(
		"%s exports only organization actions",
		{ timeout: 60_000 },
		async (_name, path) => {
			const exports: Record<string, unknown> = await import(pathToFileURL(path).href);
			const unproduced = Object.entries(exports)
				.filter(([, value]) => typeof value === "function" && !isOrganizationAction(value))
				.map(([name]) => name)
				.filter((name) => !(`${settingsPath(path)}#${name}` in ACCOUNT_EXEMPTIONS));

			expect(unproduced).toEqual([]);
		},
	);

	it("lists only settings folders that still have server action modules", () => {
		const foldersWithActions = new Set(useServerModules.map(folderOf));

		expect(NOT_YET_MIGRATED.filter((folder) => !foldersWithActions.has(folder))).toEqual([]);
	});

	it("gives every account exemption a reason and an existing module", () => {
		for (const [key, reason] of Object.entries(ACCOUNT_EXEMPTIONS)) {
			expect(reason.trim(), key).not.toBe("");
			expect(useServerModules.map(settingsPath), key).toContain(key.split("#")[0]);
		}
	});
});
