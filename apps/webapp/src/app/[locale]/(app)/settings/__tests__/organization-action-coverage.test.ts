/**
 * Every settings server action goes through `organizationAction` (ADR 0002,
 * #1592). This imports every settings `"use server"` module and fails on any
 * exported function the module did not produce. Only the account actions below
 * are exempt.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	isOrganizationAction,
	noInput,
	organizationAction,
} from "@/lib/organization-action/organization-action";

const settingsDir = join(import.meta.dirname, "..");
const srcDir = resolve(settingsDir, "../../../..");

/**
 * Account actions belong to no organization, so settings access does not
 * govern them (ADR 0002). Each permanent exemption names its export as
 * `<path under settings>#<export>` and gives the reason.
 */
const ACCOUNT_EXEMPTIONS: Record<string, string> = {
	"profile/actions.ts#changePassword":
		"The password signs the user in to every organization; Better Auth checks the current password.",
	"profile/actions.ts#updateProfileImage":
		"The profile picture is the user's own, shown in every organization they belong to.",
	"profile/actions.ts#updateProfileDetails":
		"The user's name and personal details are their own across organizations; it only mirrors them onto their own active employee record.",
	"profile/actions.ts#updateProfile":
		"Dispatches to updateProfileDetails or updateProfileImage, both account actions.",
	"profile/actions.ts#updateTimezone":
		"The user's own time zone applies in every organization; usable before and outside any membership.",
	"profile/actions.ts#getCurrentTimezone": "Reads the user's own time zone, an account detail.",
	"profile/actions.ts#updateWeekStartDay":
		"The user's own week start is a display preference across organizations.",
	"profile/actions.ts#getWeekStartDay": "Reads the user's own week start, an account detail.",
	"profile/actions.ts#updateTimeFormat":
		"The user's own 12h/24h time format is a display preference across organizations.",
	"profile/actions.ts#getTimeFormat": "Reads the user's own time format, an account detail.",
};

/** Auth modules a settings action test must not replace (ADR 0002): it stubs `AuthService` instead. */
const AUTH_MODULES = ["@/lib/auth-helpers", "@/lib/auth", "@/lib/effect/services/auth.service"];

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(path) : [path];
	});
}

const settingsFiles = filesUnder(settingsDir);
const isTestFile = (path: string) => /\.test\.tsx?$/.test(path);
const sourceFiles = settingsFiles.filter(
	(path) =>
		/\.tsx?$/.test(path) &&
		!isTestFile(path) &&
		!/\.typecheck\.tsx?$/.test(path) &&
		!path.split(sep).includes("__tests__"),
);

/** A module-level directive: the first statement after any leading comments. */
function isUseServerModule(path: string): boolean {
	const source = readFileSync(path, "utf8").replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
	return /^["']use server["']/.test(source);
}

const settingsPath = (path: string) => relative(settingsDir, path).split(sep).join("/");

const useServerModules = sourceFiles.filter(isUseServerModule);

/** The exported functions of a settings `"use server"` module that `organizationAction` did not produce. */
function unproducedExports(modulePath: string, exports: Record<string, unknown>): string[] {
	return Object.entries(exports)
		.filter(([, value]) => typeof value === "function" && !isOrganizationAction(value))
		.map(([name]) => name)
		.filter((name) => !(`${modulePath}#${name}` in ACCOUNT_EXEMPTIONS));
}

/** The file an import specifier of `fromFile` names, if it is a source file. */
function resolveImport(fromFile: string, specifier: string): string | null {
	const base = specifier.startsWith("@/")
		? join(srcDir, specifier.slice(2))
		: specifier.startsWith(".")
			? resolve(dirname(fromFile), specifier)
			: null;
	if (!base) return null;
	const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
	return candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate)) ?? null;
}

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map(
		(match) => match[1],
	);
}

function mockedAuthModules(source: string): string[] {
	return [...source.matchAll(/vi\.(?:mock|doMock)\(\s*["']([^"']+)["']/g)]
		.map((match) => match[1])
		.filter((specifier) => AUTH_MODULES.includes(specifier));
}

/**
 * Unit tests of settings actions: test files that import a settings `"use server"`
 * module. PostgreSQL suites (`*.integration.test.ts`) are exempt on purpose: they
 * test the real `AuthService` against real membership and employee rows, so they
 * stand in a Better Auth session by mocking `@/lib/auth` (`auth.api.getSession`);
 * `organizationActionStubLayer` would skip the very resolution they cover.
 */
const actionTests = settingsFiles
	.filter((path) => isTestFile(path) && !/\.integration\.test\.tsx?$/.test(path))
	.filter((path) =>
		importSpecifiers(readFileSync(path, "utf8")).some((specifier) => {
			const target = resolveImport(path, specifier);
			return target !== null && useServerModules.includes(target);
		}),
	);

describe("settings server actions go through organizationAction", () => {
	it("finds the settings server action modules", () => {
		expect(useServerModules.length).toBeGreaterThan(100);
	});

	it.each(useServerModules.map((path) => [settingsPath(path), path]))(
		"%s exports only organization actions",
		{ timeout: 60_000 },
		async (name, path) => {
			const exports: Record<string, unknown> = await import(pathToFileURL(path).href);

			expect(unproducedExports(name, exports)).toEqual([]);
		},
	);

	it("refuses an exported function that organizationAction did not produce", () => {
		const produced = organizationAction(
			{ name: "coverage.produced", requires: "member", schema: noInput },
			() => Effect.succeed(null),
		);
		const handWritten = async () => ({ success: true as const, data: null });

		expect(
			unproducedExports("teams/actions.ts", { produced, handWritten, NOT_A_FUNCTION: "x" }),
		).toEqual(["handWritten"]);
		expect(unproducedExports("profile/actions.ts", { changePassword: handWritten })).toEqual([]);
		expect(unproducedExports("teams/actions.ts", { changePassword: handWritten })).toEqual([
			"changePassword",
		]);
	});

	it("gives every account exemption a reason and an existing module", () => {
		for (const [key, reason] of Object.entries(ACCOUNT_EXEMPTIONS)) {
			expect(reason.trim(), key).not.toBe("");
			expect(useServerModules.map(settingsPath), key).toContain(key.split("#")[0]);
		}
	});
});

/**
 * Functions named like a local access guard (`require*`, `ensure*`, `assert*`).
 * Settings action files work out access with shared loaders and refuse through
 * `refuseUnless`; data checks take other names (`validate*`, `load*`, `refuse*`).
 */
function guardShapedFunctions(source: string): string[] {
	return [
		...source.matchAll(
			/(?:function\s+|(?:const|let)\s+)((?:require|ensure|assert)[A-Z]\w*)\s*(?:[=(<]|:)/g,
		),
	].map((match) => match[1]);
}

const settingsActionSources = sourceFiles.filter((path) => /\.ts$/.test(path));

describe("settings action files keep no local access guards", () => {
	it("tells a guard-shaped function from other names", () => {
		expect(
			guardShapedFunctions(`
				function requireTeamPermission(actor) {}
				export function ensureSettingsActorCanAccessProjectTarget(actor) {}
				const requireMonthPermission = (actor) => actor;
				async function assertDefaultRoleTemplate() {}
				function refuseUnlessManaged() {}
				const required = requireX;
				yield* requireOther(actor);
			`),
		).toEqual([
			"requireTeamPermission",
			"ensureSettingsActorCanAccessProjectTarget",
			"requireMonthPermission",
			"assertDefaultRoleTemplate",
		]);
	});

	it.each(settingsActionSources.map((path) => [settingsPath(path), path]))(
		"%s defines no require*, ensure* or assert* function",
		(_name, path) => {
			expect(guardShapedFunctions(readFileSync(path, "utf8"))).toEqual([]);
		},
	);
});

describe("settings action tests stub AuthService instead of mocking auth modules", () => {
	it("finds the settings action tests", () => {
		expect(actionTests.length).toBeGreaterThan(50);
	});

	it("tells a mocked auth module from other mocks", () => {
		expect(
			mockedAuthModules(`
				vi.mock("@/lib/auth", () => ({}));
				vi.doMock('@/lib/auth-helpers', () => ({}));
				vi.mock("@/lib/effect/services/auth.service");
				vi.mock("@/lib/auth/auth-transaction", () => ({}));
				vi.mock("@/lib/effect/runtime", () => ({}));
			`),
		).toEqual(["@/lib/auth", "@/lib/auth-helpers", "@/lib/effect/services/auth.service"]);
	});

	it.each(actionTests.map((path) => [settingsPath(path), path]))(
		"%s mocks no auth module",
		(_name, path) => {
			expect(mockedAuthModules(readFileSync(path, "utf8"))).toEqual([]);
		},
	);
});
