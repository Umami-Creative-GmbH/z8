import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mergeCatalogRecords } from "./catalog-store";
import {
	loadCatalogSlice,
	loadCompleteServerTranslations,
	loadShellTranslations,
} from "./load-translations";
import {
	getRouteCatalogScope,
	ROUTE_CATALOG_SCOPES,
} from "./route-catalog-scopes";
import { ALL_LANGUAGES, type TreeTranslationsData } from "./shared";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
const root = path.resolve("src/app/[locale]");
const pages = readdirSync(root, { recursive: true })
	.map(String)
	.filter((file) => file.endsWith("page.tsx"));
function pathname(file: string) {
	return `/${file
		.replaceAll("\\", "/")
		.split("/")
		.slice(0, -1)
		.filter((segment) => !segment.startsWith("("))
		.join("/")}`;
}
function leaves(
	tree: TreeTranslationsData,
	prefix = "",
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(tree).flatMap(([key, value]) =>
			typeof value === "string"
				? [[prefix + key, value]]
				: Object.entries(leaves(value, `${prefix}${key}.`)),
		),
	);
}

const modules = new Map<string, { keys: string[]; imports: string[] }>();
function moduleInfo(file: string) {
	const cached = modules.get(file);
	if (cached) return cached;
	const source = readFileSync(file, "utf8");
	const result = { keys: [] as string[], imports: [] as string[] };
	modules.set(file, result);
	if (
		/^["']use server["']/.test(source) ||
		source.includes('import "server-only"')
	)
		return result;
	for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g))
		result.keys.push(match[1]);
	for (const match of source.matchAll(/keyName=["']([^"']+)["']/g))
		result.keys.push(match[1]);
	const imports = [
		...source.matchAll(
			/(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/g,
		),
		// UI lazy imports live in TSX modules. Do not crawl runtime backend job
		// registries: their bot translators use the complete server catalog.
		...(file.endsWith(".tsx")
			? source.matchAll(/\bimport\(\s*["']([^"']+)["']/g)
			: []),
	];
	for (const match of imports) {
		const specifier = match[1];
		const target = specifier.startsWith("@/")
			? path.resolve("src", specifier.slice(2))
			: specifier.startsWith(".")
				? path.resolve(path.dirname(file), specifier)
				: null;
		if (target) {
			const resolved = [
				`${target}.tsx`,
				`${target}.ts`,
				path.join(target, "index.tsx"),
				path.join(target, "index.ts"),
			].find((candidate) => existsSync(candidate));
			if (resolved && !resolved.includes(`${path.sep}tolgee${path.sep}`))
				result.imports.push(resolved);
		}
	}
	return result;
}
function reachableKeys(file: string) {
	const pending = [file];
	const visited = new Set<string>();
	const keys = new Set<string>();
	while (pending.length) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		const info = moduleInfo(current);
		for (const key of info.keys) keys.add(key);
		pending.push(...info.imports);
	}
	return keys;
}

describe("route catalog wiring", () => {
	it.each(ALL_LANGUAGES)(
		"covers literal translation keys in pages and reachable components/dialogs in %s",
		async (locale) => {
			const shell = await loadShellTranslations(locale);
			const complete = leaves(
				(await loadCompleteServerTranslations(locale))[
					locale
				] as TreeTranslationsData,
			);
			const records = new Map(
				await Promise.all(
					ROUTE_CATALOG_SCOPES.map(
						async (scope) =>
							[
								scope.route,
								leaves(
									mergeCatalogRecords(
										shell,
										await loadCatalogSlice(locale, scope.namespaces),
									).records[locale] as TreeTranslationsData,
								),
							] as const,
					),
				),
			);
			const missing: string[] = [];
			for (const page of pages) {
				const scope = getRouteCatalogScope(pathname(page));
				if (!scope) continue;
				const actual = records.get(scope.route);
				for (const key of reachableKeys(path.join(root, page)))
					if (complete[key] !== undefined && actual?.[key] !== complete[key])
						missing.push(`${pathname(page)}: ${key}`);
			}
			expect(missing).toEqual([]);
		},
		20000,
	);
	it("covers shared app layout and each installed layout before children load", async () => {
		const shell = await loadShellTranslations("en");
		const complete = leaves(
			(await loadCompleteServerTranslations("en")).en as TreeTranslationsData,
		);
		const missing: string[] = [];
		const layouts = readdirSync(root, { recursive: true })
			.map(String)
			.filter((file) => file.endsWith("layout.tsx"));
		for (const layout of layouts) {
			const source = readFileSync(path.join(root, layout), "utf8");
			const route = /route="([^"]+)"/.exec(source)?.[1];
			const scope = route ? getRouteCatalogScope(route) : undefined;
			// The root provider always applies the shell through the merge, which adds its aliases.
			const actual = leaves(
				mergeCatalogRecords(
					shell,
					scope
						? await loadCatalogSlice("en", scope.namespaces)
						: { ...shell, records: { en: {} } },
				).records.en as TreeTranslationsData,
			);
			for (const key of reachableKeys(path.join(root, layout)))
				if (complete[key] !== undefined && actual[key] !== complete[key])
					missing.push(`${layout}: ${key}`);
		}
		expect(missing).toEqual([]);
	}, 20000);
	it("covers every locale page with an installed boundary ancestor", () => {
		const uncoveredPages = pages.filter((page) => {
			const scope = getRouteCatalogScope(pathname(page));
			if (!scope) return true;
			let directory = path.dirname(path.join(root, page));
			const sources = [readFileSync(path.join(root, page), "utf8")];
			while (directory.startsWith(root) && directory !== root) {
				const layout = path.join(directory, "layout.tsx");
				if (existsSync(layout)) sources.push(readFileSync(layout, "utf8"));
				directory = path.dirname(directory);
			}
			return !sources.some(
				(source) =>
					source.includes("RouteTranslationBoundary") &&
					source.includes(`route="${scope.route}"`),
			);
		});
		expect(uncoveredPages).toEqual([]);
	});
	it("loads the sick-note strings where sick notes are recorded and managed (#984)", () => {
		expect(getRouteCatalogScope("/team/absences")?.namespaces).toEqual(
			expect.arrayContaining(["calendar", "settings/people"]),
		);
		expect(getRouteCatalogScope("/personnel-files/employee-1")?.namespaces).toEqual(
			expect.arrayContaining(["calendar", "settings/people"]),
		);
	});
	it("uses segment boundaries and longest-prefix settings scopes", () => {
		expect(
			getRouteCatalogScope("/settings/clockodo-import")?.namespaces,
		).toContain("settings/integrations");
		expect(
			getRouteCatalogScope("/settings/vacation/employees/123")?.namespaces,
		).toContain("settings/vacation");
		expect(getRouteCatalogScope("/reports/projects")?.route).toBe("/reports");
		expect(getRouteCatalogScope("/reportsextra")).toBeUndefined();
	});
	it.each(ALL_LANGUAGES)(
		"preserves audited shared, recovery, nested and feature labels in %s",
		async (locale) => {
			const shell = await loadShellTranslations(locale);
			const complete = leaves(
				(await loadCompleteServerTranslations(locale))[
					locale
				] as TreeTranslationsData,
			);
			for (const scope of ROUTE_CATALOG_SCOPES) {
				const slice = mergeCatalogRecords(
					shell,
					await loadCatalogSlice(locale, scope.namespaces),
				);
				const actual = leaves(slice.records[locale] as TreeTranslationsData);
				for (const key of scope.keys)
					if (complete[key] !== undefined)
						expect(actual[key], `${scope.route}: ${key}`).toBe(complete[key]);
			}
		},
	);
	it.each(ALL_LANGUAGES)(
		"serializes shell plus installed ancestor feature slices below the complete dictionary in %s",
		async (locale) => {
			const shell = await loadShellTranslations(locale);
			const completeBytes = Buffer.byteLength(
				JSON.stringify(await loadCompleteServerTranslations(locale)),
			);
			const rootBytes = Buffer.byteLength(JSON.stringify(shell));
			const scopeBytes = new Map(
				await Promise.all(
					ROUTE_CATALOG_SCOPES.map(
						async (scope) =>
							[
								scope.route,
								Buffer.byteLength(
									JSON.stringify(
										await loadCatalogSlice(locale, scope.namespaces),
									),
								),
							] as const,
					),
				),
			);
			const measurements: Record<string, number> = {};
			for (const page of pages) {
				let directory = path.dirname(path.join(root, page));
				const sources = [readFileSync(path.join(root, page), "utf8")];
				while (directory.startsWith(root) && directory !== root) {
					const layout = path.join(directory, "layout.tsx");
					if (existsSync(layout)) sources.push(readFileSync(layout, "utf8"));
					directory = path.dirname(directory);
				}
				const routes = sources.flatMap((source) =>
					[...source.matchAll(/route="([^"]+)"/g)].map((match) => match[1]),
				);
				const bytes =
					rootBytes +
					routes.reduce((sum, route) => sum + (scopeBytes.get(route) ?? 0), 0);
				expect(bytes, pathname(page)).toBeLessThan(completeBytes);
				measurements[pathname(page)] = bytes;
			}
			process.stdout.write(
				`ROUTE_CATALOG_BYTES ${JSON.stringify({ locale, rootBytes, completeBytes, measurements })}\n`,
			);
		},
	);
});
