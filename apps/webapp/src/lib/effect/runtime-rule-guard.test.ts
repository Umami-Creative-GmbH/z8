import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the runtime rule (docs/refs/effect.md, "Runtime"): code runs
 * AppLayer services on the shared runtime and never provides `AppLayer`, or a
 * layer that is a member of it, itself.
 */

const SOURCE_ROOT = join(process.cwd(), "src");
const RUNTIME_MODULE = "lib/effect/runtime.ts";
const RULE_DOC = "docs/refs/effect.md#runtime";

/** Test sources may build their own layers and runtimes. */
const TEST_SOURCE = /(?:^|\/)(?:__tests__|test)\/|\.test\.tsx?$|\.test[.-]fixture\.tsx?$/;

const LAYER_CALL = /\b(?:Effect\.provide|Layer\.(?:provide|provideMerge|merge|mergeAll))\s*\(/g;
const LOCAL_REBUILD = /\{\s*local\s*:\s*true\s*\}/;

function collectSourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const filePath = join(directory, entry);
		if (statSync(filePath).isDirectory()) {
			return collectSourceFiles(filePath);
		}
		return /\.tsx?$/.test(entry) ? [filePath] : [];
	});
}

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The text between the call's opening parenthesis and its matching close. */
function callArguments(source: string, openParen: number): string {
	let depth = 0;
	for (let index = openParen; index < source.length; index++) {
		const char = source[index];
		if (char === "(") depth++;
		if (char === ")" && --depth === 0) return source.slice(openParen + 1, index);
	}
	return source.slice(openParen + 1);
}

function memberPattern(member: string): RegExp {
	return new RegExp(`(?<![\\w.])${member.replace(/\./g, "\\.")}\\b`);
}

/**
 * The layers `AppLayer` is composed of, read from its `Layer.mergeAll(...)` in the
 * runtime module, so a service added there is guarded without editing this test.
 */
function appLayerMembers(runtimeSource: string): string[] {
	const start = runtimeSource.search(/export const AppLayer = Layer\.mergeAll\(/);
	if (start === -1) throw new Error(`AppLayer composition not found in ${RUNTIME_MODULE}`);
	const body = callArguments(runtimeSource, runtimeSource.indexOf("(", start));
	const members = body.match(/\b[A-Z]\w*(?:\.Live\b|Live\b)/g) ?? [];
	return [...new Set(members)].sort();
}

/** Runtime-rule violations in one non-test source file. */
function findRuntimeRuleViolations(source: string, members: readonly string[]): string[] {
	const code = stripComments(source);
	const violations: string[] = [];
	const forbidden = ["AppLayer", ...members];

	for (const match of code.matchAll(LAYER_CALL)) {
		const callee = match[0].replace(/\s*\($/, "");
		const args = callArguments(code, (match.index ?? 0) + match[0].length - 1);
		if (LOCAL_REBUILD.test(args)) continue;
		for (const name of forbidden) {
			if (memberPattern(name).test(args)) violations.push(`${callee}(${name})`);
		}
	}

	return [...new Set(violations)];
}

const runtimeSource = readFileSync(join(SOURCE_ROOT, RUNTIME_MODULE), "utf8");
const members = appLayerMembers(runtimeSource);

describe("runtime rule guard", () => {
	it("derives the AppLayer members from the runtime module", () => {
		expect(members).toEqual(
			expect.arrayContaining([
				"AnalyticsService.Live",
				"AuthServiceLive",
				"DatabaseServiceLive",
				"TimeEntryServiceLive",
				"WorkPolicyServiceLive",
			]),
		);
	});

	it("flags a provided AppLayer or AppLayer member", () => {
		expect(
			findRuntimeRuleViolations(
				"return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));",
				members,
			),
		).toEqual(["Effect.provide(AppLayer)"]);
		expect(
			findRuntimeRuleViolations(
				"void Effect.runPromise(query.pipe(Effect.provide(\n\tDatabaseServiceLive,\n)));",
				members,
			),
		).toEqual(["Effect.provide(DatabaseServiceLive)"]);
		expect(
			findRuntimeRuleViolations(
				"const Live = Layer.mergeAll(AppLayer, FooLive.pipe(Layer.provide(DatabaseServiceLive)));",
				members,
			),
		).toEqual([
			"Layer.mergeAll(AppLayer)",
			"Layer.mergeAll(DatabaseServiceLive)",
			"Layer.provide(DatabaseServiceLive)",
		]);
		expect(
			findRuntimeRuleViolations("effect.pipe(Effect.provide(AnalyticsService.Live))", members),
		).toEqual(["Effect.provide(AnalyticsService.Live)"]);
	});

	it("allows local transaction rebuilds, outside layers and comments", () => {
		expect(
			findRuntimeRuleViolations(
				[
					"// Effect.provide(AppLayer) would rebuild the application layer.",
					"effect.pipe(Effect.provide(TimeEntryServiceLive, { local: true }));",
					"effect.pipe(Effect.provide(BillingServicesLive));",
					"effect.pipe(Effect.provideService(DatabaseService, transactionDb));",
					"const Layer2 = SurchargeServiceLive.pipe(Layer.provide(MyDatabaseServiceLive));",
				].join("\n"),
				members,
			),
		).toEqual([]);
	});

	it("keeps non-test source from providing AppLayer or its members", () => {
		const offenders = collectSourceFiles(SOURCE_ROOT)
			.map((filePath) => relative(SOURCE_ROOT, filePath).replace(/\\/g, "/"))
			.filter((filePath) => filePath !== RUNTIME_MODULE && !TEST_SOURCE.test(filePath))
			.flatMap((filePath) => {
				const violations = findRuntimeRuleViolations(
					readFileSync(join(SOURCE_ROOT, filePath), "utf8"),
					members,
				);
				return violations.length > 0 ? [`src/${filePath}: ${violations.join(", ")}`] : [];
			});

		expect(
			offenders,
			`Run AppLayer services on the shared runtime instead of providing AppLayer or its members; see ${RULE_DOC}.`,
		).toEqual([]);
	});
});
