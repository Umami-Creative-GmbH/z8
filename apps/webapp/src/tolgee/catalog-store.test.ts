import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type CatalogSlice, canonicalizeNamespaces } from "./catalog-slices";
import {
	applyCatalogRecords,
	hasCatalogNamespaces,
	isApplyingCatalogRecords,
	mergeCatalogRecords,
} from "./catalog-store";
import { loadCatalogSlice, loadShellTranslations } from "./load-translations";
import {
	ALL_LANGUAGES,
	ALL_NAMESPACES,
	type Namespace,
	TolgeeBase,
	type TreeTranslationsData,
} from "./shared";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

function fresh(locale: string, namespaces: readonly Namespace[]) {
	return namespaces.map((namespace) => ({
		namespace,
		data: JSON.parse(
			readFileSync(
				join(process.cwd(), "messages", namespace, `${locale}.json`),
				"utf8",
			),
		) as TreeTranslationsData,
	}));
}
function predecessor(sources: ReturnType<typeof fresh>) {
	const tree: TreeTranslationsData = {};
	function merge(target: TreeTranslationsData, source: TreeTranslationsData) {
		for (const [key, value] of Object.entries(source)) {
			if (typeof value === "object" && typeof target[key] === "object")
				merge(target[key] as TreeTranslationsData, value);
			else target[key] = value;
		}
	}
	for (const { data } of sources) merge(tree, data);
	for (const { namespace, data } of sources)
		for (const [key, value] of Object.entries(data))
			tree[`${namespace}:${key}`] = value;
	return tree;
}
function empty(locale: string): CatalogSlice {
	return { locale, namespaces: [], records: { [locale]: {} }, keyOwners: {} };
}

describe("cumulative catalogs", () => {
	it("rejects complete namespace identities without locale records and leaves readiness empty", () => {
		const instance = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "en",
		});
		for (const records of [
			{},
			{ en: {} },
			{ de: { reports: { title: "Reports" } } },
		]) {
			expect(() =>
				applyCatalogRecords(instance, {
					locale: "en",
					namespaces: ["reports"],
					records,
					keyOwners: {},
				}),
			).toThrow(/records/i);
			expect(hasCatalogNamespaces(instance, ["reports"])).toBe(false);
			expect(isApplyingCatalogRecords(instance)).toBe(false);
		}
	});
	it("merges partial siblings without mutating inputs or asserting readiness", () => {
		const first = {
			...empty("en"),
			records: { en: { settings: { title: "Settings" } } },
		};
		const second = {
			...empty("en"),
			records: { en: { settings: { employees: { title: "Employees" } } } },
		};
		const before = structuredClone([first, second]);
		const merged = mergeCatalogRecords(first, second);
		expect(merged.records.en).toMatchObject({
			settings: { title: "Settings", employees: { title: "Employees" } },
		});
		expect(merged.namespaces).toEqual([]);
		expect([first, second]).toEqual(before);
		expect(() => mergeCatalogRecords(first, empty("de"))).toThrow(/locale/i);
	});
	it.each(ALL_LANGUAGES)(
		"reconstructs changing first-contributor and complete aliases in %s",
		async (locale) => {
			const groups: Namespace[][] = [
				["settings/people", "settings/enterprise"],
				["billing", "analytics", "teamsBot"],
				["settings/generic", "common"],
			];
			for (const order of [groups, [...groups].reverse()]) {
				let accumulated = empty(locale);
				let selected: Namespace[] = [];
				for (const group of order) {
					const incoming = await loadCatalogSlice(locale, group);
					const before = structuredClone([accumulated, incoming]);
					const merged = mergeCatalogRecords(accumulated, incoming);
					selected = [...canonicalizeNamespaces([...selected, ...group])];
					expect(merged.records).toEqual({
						[locale]: predecessor(fresh(locale, selected)),
					});
					expect([accumulated, incoming]).toEqual(before);
					accumulated = merged;
				}
			}
			let accumulated = empty(locale);
			for (const namespace of [...ALL_NAMESPACES].reverse())
				accumulated = mergeCatalogRecords(
					accumulated,
					await loadCatalogSlice(locale, [namespace]),
				);
			const expected = predecessor(fresh(locale, ALL_NAMESPACES));
			expect(accumulated.records).toEqual({ [locale]: expected });
			const instance = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
				language: locale,
			});
			applyCatalogRecords(instance, accumulated);
			function flatten(
				tree: TreeTranslationsData,
				prefix = "",
			): Record<string, string> {
				return Object.fromEntries(
					Object.entries(tree).flatMap(([key, value]) =>
						typeof value === "string"
							? [[`${prefix}${key}`, value]]
							: Object.entries(flatten(value, `${prefix}${key}.`)),
					),
				);
			}
			expect(instance.getRecord({ language: locale })?.data).toEqual(
				flatten(expected),
			);
			expect(instance.t("settings/generic:settings.apiKeys.active")).toBe(
				(expected["settings/generic:settings"] as TreeTranslationsData)
					.apiKeys &&
					(
						(expected["settings/generic:settings"] as TreeTranslationsData)
							.apiKeys as TreeTranslationsData
					).active,
			);
			expect(
				instance.getRecord({ language: locale })?.data["common.more"],
			).toBe((expected.common as TreeTranslationsData).more);
		},
	);
	it.each(ALL_LANGUAGES)(
		"retains shell contributions and ownership without complete readiness in %s",
		async (locale) => {
			const shell = await loadShellTranslations(locale);
			const feature = await loadCatalogSlice(locale, [
				"settings/people",
				"common",
			]);
			// Independent source projection from raw source membership. Every available shell
			// primary leaf contributes to its intrinsic source; collisions use shell ownership.
			const primary = shell.records[locale] as TreeTranslationsData;
			function project(
				raw: TreeTranslationsData,
				available: TreeTranslationsData,
				ns: Namespace,
				path: string[] = [],
			): TreeTranslationsData {
				const out: TreeTranslationsData = {};
				for (const [key, value] of Object.entries(raw)) {
					const actual = available[key];
					const next = [...path, key];
					if (
						typeof value === "string" &&
						typeof actual === "string" &&
						(!shell.keyOwners[JSON.stringify(next)] ||
							shell.keyOwners[JSON.stringify(next)] === ns)
					)
						out[key] = actual;
					else if (typeof value === "object" && typeof actual === "object") {
						const nested = project(value, actual, ns, next);
						if (Object.keys(nested).length) out[key] = nested;
					}
				}
				return out;
			}
			const sources = fresh(locale, ALL_NAMESPACES).map(
				({ namespace, data }) => ({
					namespace,
					data: feature.namespaces.includes(namespace)
						? data
						: project(data, primary, namespace),
				}),
			);
			const expected = predecessor(
				sources.filter(({ data }) => Object.keys(data).length),
			);
			for (const [first, last] of [
				[shell, feature],
				[feature, shell],
			]) {
				const merged = mergeCatalogRecords(first, last);
				expect(merged.records).toEqual({ [locale]: expected });
				expect(merged.namespaces).toEqual(feature.namespaces);
			}
			const instance = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
				language: locale,
			});
			applyCatalogRecords(instance, shell);
			expect(hasCatalogNamespaces(instance, ["common"])).toBe(false);
			applyCatalogRecords(instance, feature);
			expect(hasCatalogNamespaces(instance, ["common"])).toBe(true);
			expect(hasCatalogNamespaces(instance, ["settings/enterprise"])).toBe(
				false,
			);
		},
	);
	it("guards nested injection and isolates language instances", async () => {
		const en = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "en",
		});
		const de = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "de",
		});
		const slice = await loadCatalogSlice("en", ["reports"]);
		const nestedSlice = await loadCatalogSlice("en", ["calendar"]);
		let nested = false;
		en.on("cache", () => {
			expect(isApplyingCatalogRecords(en)).toBe(true);
			if (!nested) {
				nested = true;
				applyCatalogRecords(en, nestedSlice);
				expect(isApplyingCatalogRecords(en)).toBe(true);
			}
		});
		applyCatalogRecords(en, slice);
		expect(hasCatalogNamespaces(en, ["reports", "calendar"])).toBe(true);
		expect(isApplyingCatalogRecords(en)).toBe(false);
		expect(hasCatalogNamespaces(de, ["reports"])).toBe(false);
		expect(() => applyCatalogRecords(de, slice)).toThrow(/locale/i);
		expect(de.getRecord({ language: "en" })).toBeUndefined();
	});
	it("does not mark failed SDK applications loaded and clears the injection guard for retry", async () => {
		const actual = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "en",
		});
		let fail = true;
		const instance = {
			...actual,
			addStaticData: (records: Parameters<typeof actual.addStaticData>[0]) => {
				expect(isApplyingCatalogRecords(instance)).toBe(true);
				if (fail) throw new Error("SDK injection failed");
				actual.addStaticData(records);
			},
		};
		const slice = await loadCatalogSlice("en", ["reports"]);
		expect(() => applyCatalogRecords(instance, slice)).toThrow(
			"SDK injection failed",
		);
		expect(hasCatalogNamespaces(instance, ["reports"])).toBe(false);
		expect(isApplyingCatalogRecords(instance)).toBe(false);
		fail = false;
		applyCatalogRecords(instance, slice);
		expect(hasCatalogNamespaces(instance, ["reports"])).toBe(true);
		expect(actual.t("reports.title")).not.toBe("reports.title");
		expect(isApplyingCatalogRecords(instance)).toBe(false);
	});
	it("rolls back a successful nested application when the outer listener throws and permits the same slice to retry", async () => {
		const instance = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "en",
		});
		const baseline = await loadCatalogSlice("en", ["common"]);
		const outer = await loadCatalogSlice("en", ["reports"]);
		const inner = await loadCatalogSlice("en", ["calendar"]);
		const later = await loadCatalogSlice("en", ["dashboard"]);
		applyCatalogRecords(instance, baseline);
		const before = structuredClone(
			instance.getRecord({ language: "en" })?.data,
		);
		let nested = false;
		const failure = new Error("outer cache listener failed");
		let cacheEvents = 0;
		const subscription = instance.on("cache", () => {
			cacheEvents++;
			expect(isApplyingCatalogRecords(instance)).toBe(true);
			if (nested) return;
			nested = true;
			applyCatalogRecords(instance, inner);
			expect(hasCatalogNamespaces(instance, ["calendar"])).toBe(true);
			throw failure;
		});
		expect(() => applyCatalogRecords(instance, outer)).toThrow(failure);
		expect(cacheEvents).toBe(2);
		subscription.unsubscribe();
		expect(isApplyingCatalogRecords(instance)).toBe(false);
		expect(hasCatalogNamespaces(instance, ["common"])).toBe(true);
		expect(hasCatalogNamespaces(instance, ["reports"])).toBe(false);
		expect(hasCatalogNamespaces(instance, ["calendar"])).toBe(false);
		expect(instance.getRecord({ language: "en" })?.data).toEqual(before);
		const retried = instance.on("cache", () => {
			cacheEvents++;
			expect(isApplyingCatalogRecords(instance)).toBe(true);
		});
		applyCatalogRecords(instance, inner);
		expect(hasCatalogNamespaces(instance, ["calendar"])).toBe(true);
		expect(instance.t("absences.title")).toBe("Absences");
		expect(instance.t("calendar:absences.title")).toBe("Absences");
		applyCatalogRecords(instance, later);
		expect(
			hasCatalogNamespaces(instance, ["common", "calendar", "dashboard"]),
		).toBe(true);
		expect(instance.t("absences.title")).toBe("Absences");
		expect(instance.t("calendar:absences.title")).toBe("Absences");
		expect(cacheEvents).toBe(4);
		retried.unsubscribe();
		expect(
			instance.getRecord({ language: "en" })?.data["reports.title"],
		).toBeUndefined();
		expect(isApplyingCatalogRecords(instance)).toBe(false);
	});
	it("keeps the outer application when its listener catches an inner application failure", async () => {
		const instance = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
			language: "en",
		});
		const outer = await loadCatalogSlice("en", ["reports"]);
		const inner = await loadCatalogSlice("en", ["calendar"]);
		let entered = false;
		const subscription = instance.on("cache", () => {
			if (entered) throw new Error("inner listener failed");
			entered = true;
			expect(() => applyCatalogRecords(instance, inner)).toThrow(
				"inner listener failed",
			);
			expect(isApplyingCatalogRecords(instance)).toBe(true);
		});
		applyCatalogRecords(instance, outer);
		subscription.unsubscribe();
		expect(hasCatalogNamespaces(instance, ["reports"])).toBe(true);
		expect(hasCatalogNamespaces(instance, ["calendar"])).toBe(false);
		expect(instance.t("reports.title")).toBe("Employee Reports");
		expect(
			instance.getRecord({ language: "en" })?.data["absences.title"],
		).toBeUndefined();
		applyCatalogRecords(instance, inner);
		expect(hasCatalogNamespaces(instance, ["reports", "calendar"])).toBe(true);
		expect(instance.t("reports.title")).toBe("Employee Reports");
		expect(instance.t("absences.title")).toBe("Absences");
		expect(isApplyingCatalogRecords(instance)).toBe(false);
	});
});
