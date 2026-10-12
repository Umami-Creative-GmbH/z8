import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	CATALOG_SOURCE_METADATA,
	type CatalogSourceMask,
	canonicalizeNamespaces,
	normalizeCatalogLocale,
} from "./catalog-slices";
import {
	loadCatalogSlice,
	loadCompleteServerTranslations,
} from "./load-translations";
import {
	ALL_LANGUAGES,
	ALL_NAMESPACES,
	loadNamespaces,
	type Namespace,
} from "./shared";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

function leaves(value: unknown, path: string[] = []): [string, string][] {
	if (typeof value === "string") return [[JSON.stringify(path), value]];
	return Object.entries(value as object).flatMap(([key, child]) =>
		leaves(child, [...path, key]),
	);
}

// Independent fresh-file fixture of the predecessor: merge primary branches in
// order, then add aliases pointing at each source (including its merged siblings).
function predecessor(locale: string, namespaces: readonly Namespace[]) {
	type Tree = { [key: string]: Tree | string };
	const sources = namespaces.map((namespace) => ({
		namespace,
		data: JSON.parse(
			readFileSync(
				join(process.cwd(), "messages", namespace, `${locale}.json`),
				"utf8",
			),
		) as Tree,
	}));
	const merged: Tree = {};
	function merge(target: Tree, source: Tree) {
		for (const [key, value] of Object.entries(source)) {
			if (typeof target[key] === "object" && typeof value === "object")
				merge(target[key] as Tree, value);
			else target[key] = value;
		}
	}
	for (const { data } of sources) merge(merged, data);
	for (const { namespace, data } of sources)
		for (const [key, value] of Object.entries(data))
			merged[`${namespace}:${key}`] = value;
	return { [locale]: merged };
}

describe("public catalog slices", () => {
	it.each(ALL_LANGUAGES)(
		"checks generated source membership and collisions against fresh %s catalogs",
		(locale) => {
			const raw = Object.fromEntries(
				ALL_NAMESPACES.map((namespace) => [
					namespace,
					JSON.parse(
						readFileSync(
							join(process.cwd(), "messages", namespace, `${locale}.json`),
							"utf8",
						),
					),
				]),
			);
			function at(tree: unknown, path: string[]): unknown {
				return path.reduce<unknown>(
					(value, key) =>
						value && typeof value === "object"
							? (value as Record<string, unknown>)[key]
							: undefined,
					tree,
				);
			}
			function shape(
				namespace: Namespace,
				value: Record<string, unknown>,
				path: string[] = [],
			): CatalogSourceMask {
				return Object.fromEntries(
					Object.entries(value).map(([key, child]) => {
						const next = [...path, key];
						const shared = ALL_NAMESPACES.some(
							(other) =>
								other !== namespace && at(raw[other], next) !== undefined,
						);
						return [
							key,
							typeof child === "string" || !shared
								? 1
								: shape(namespace, child as Record<string, unknown>, next),
						];
					}),
				);
			}
			const contributors = new Map<string, Namespace[]>();
			for (const namespace of ALL_NAMESPACES)
				for (const [path] of leaves(raw[namespace]))
					contributors.set(path, [
						...(contributors.get(path) ?? []),
						namespace,
					]);
			expect(CATALOG_SOURCE_METADATA[locale]).toEqual({
				sources: Object.fromEntries(
					ALL_NAMESPACES.map((namespace) => [
						namespace,
						shape(namespace, raw[namespace]),
					]),
				),
				collisions: Object.fromEntries(
					[...contributors].filter(([, sources]) => sources.length > 1),
				),
			});
		},
	);
	it("validates and canonicalizes namespace identity in predecessor priority order", () => {
		expect(canonicalizeNamespaces(["reports", "common", "reports"])).toEqual([
			"common",
			"reports",
		]);
		expect(canonicalizeNamespaces(["reports", "analytics"])).toEqual([
			"analytics",
			"reports",
		]);
		expect(canonicalizeNamespaces([])).toEqual([]);
		expect(() => canonicalizeNamespaces(["unknown" as Namespace])).toThrow(
			/namespace/i,
		);
	});
	it("retains the predecessor's exact supported-locale normalization", () => {
		for (const locale of ALL_LANGUAGES)
			expect(normalizeCatalogLocale(locale)).toBe(locale);
		for (const locale of ["EN", "de-DE", "", "unknown"])
			expect(normalizeCatalogLocale(locale)).toBe("en");
	});
	it.each(ALL_LANGUAGES)(
		"preserves selective trees, aliases, global collision ownership and complete coverage in %s",
		async (locale) => {
			const sources = await Promise.all(
				ALL_NAMESPACES.map(async (namespace) => ({
					namespace,
					records: await loadNamespaces(locale, [namespace], { strict: true }),
				})),
			);
			const counts = new Map<string, number>();
			for (const { namespace, records } of sources) {
				for (const [path] of leaves(records[locale])) {
					if ((JSON.parse(path) as string[])[0].startsWith(`${namespace}:`))
						continue;
					counts.set(path, (counts.get(path) ?? 0) + 1);
				}
			}
			const namespaces: Namespace[] = [
				"settings/generic",
				"settings/people",
				"reports",
				"common",
			];
			const slice = await loadCatalogSlice(locale, namespaces);
			expect(slice.namespaces).toEqual(canonicalizeNamespaces(namespaces));
			expect(
				await loadCatalogSlice(
					locale,
					[...namespaces].reverse().concat("reports"),
				),
			).toEqual(slice);
			expect(slice.records).toEqual(
				await loadNamespaces(locale, canonicalizeNamespaces(namespaces), {
					strict: true,
				}),
			);
			expect(slice.records).toEqual(
				predecessor(locale, canonicalizeNamespaces(namespaces)),
			);
			const reports = sources.find((source) => source.namespace === "reports")
				?.records[locale];
			expect(slice.records[locale]).toHaveProperty(
				"reports:reports",
				(reports as Record<string, unknown>)["reports:reports"],
			);
			const expectedOwners: Record<string, Namespace> = {};
			for (const { namespace, records } of sources) {
				if (!slice.namespaces.includes(namespace)) continue;
				for (const [path] of leaves(records[locale]))
					if ((counts.get(path) ?? 0) > 1) expectedOwners[path] = namespace;
			}
			expect(slice.keyOwners).toEqual(expectedOwners);
			const complete = await loadCompleteServerTranslations(locale);
			expect(complete).toEqual(
				await loadNamespaces(locale, ALL_NAMESPACES, { strict: true }),
			);
			expect(complete).toEqual(predecessor(locale, ALL_NAMESPACES));
			expect(await loadCatalogSlice(locale, ALL_NAMESPACES)).toMatchObject({
				records: complete,
			});
			// Complete loading must not contaminate later selective imports with unrelated settings.
			expect(await loadCatalogSlice(locale, namespaces)).toEqual(slice);
			expect((await loadNamespaces(locale, ["reports"]))[locale]).toEqual(
				reports,
			);
			const reportsSlice = await loadCatalogSlice(locale, [
				"common",
				"reports",
			]);
			process.stdout.write(
				`FEATURE_CATALOG_BYTES ${JSON.stringify({ locale, reports: Buffer.byteLength(JSON.stringify(reportsSlice)), owners: Buffer.byteLength(JSON.stringify(reportsSlice.keyOwners)) })}\n`,
			);
		},
	);
});
