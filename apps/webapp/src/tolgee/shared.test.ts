import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeNamespaces } from "./catalog-slices";
import { loadRouteTranslations } from "./load-translations";
import {
	ALL_LANGUAGES,
	CATALOG_NAMESPACES,
	loadNamespaceImport,
	loadNamespaces,
	mergeTreeTranslations,
} from "./shared";

const mockState = vi.hoisted(() => ({
	cacheLife: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
	cacheLife: mockState.cacheLife,
}));

beforeEach(() => {
	mockState.cacheLife.mockClear();
});

describe("Tolgee route translations", () => {
	it("does not mutate the imported module while preserving in-load alias unions", async () => {
		const first = { settings: { first: "First" } };
		const second = { settings: { second: "Second" } };
		const loaded = await loadNamespaceImport(
			"settings/generic",
			"en",
			async () => ({ default: first }),
			{ strict: true },
		);
		const merged = mergeTreeTranslations([loaded.data, second]);
		expect(merged).toEqual({ settings: { first: "First", second: "Second" } });
		expect(loaded.data.settings).toEqual(merged.settings);
		expect(first).toEqual({ settings: { first: "First" } });
	});
	it("does not keep unnamespaced root locale files", () => {
		for (const locale of ALL_LANGUAGES) {
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(
				false,
			);
		}
	});

	it("keeps a namespace file for every supported locale", () => {
		for (const namespace of CATALOG_NAMESPACES) {
			for (const locale of ALL_LANGUAGES) {
				expect(
					existsSync(
						join(process.cwd(), `messages/${namespace}/${locale}.json`),
					),
				).toBe(true);
			}
		}
	});

	it.each(ALL_LANGUAGES)(
		"defines approval timeline actor placeholders in %s",
		(locale) => {
			const catalog = JSON.parse(
				readFileSync(
					join(process.cwd(), `messages/approvals/${locale}.json`),
					"utf8",
				),
			) as { approvals?: { timelineActor?: unknown } };
			const message = catalog.approvals?.timelineActor;

			expect(message, `${locale}: approvals.timelineActor`).toEqual(
				expect.any(String),
			);
			expect(message, `${locale}: approvals.timelineActor`).toContain("{at}");
			expect(message, `${locale}: approvals.timelineActor`).toContain(
				"{actorName}",
			);
		},
	);

	it("loads app search strings from the common namespace", async () => {
		const translations = await loadRouteTranslations("de");

		expect(translations.de).toMatchObject({
			appSearch: {
				searchOrRunCommand: "Suchen oder Befehl ausführen",
			},
		});
	});

	it("keeps German translations available after navigating from settings to dashboard", async () => {
		const translations = await loadRouteTranslations("de");

		expect(translations.de).toMatchObject({
			dashboard: {
				"managed-employees": {
					title: "Ihr Team",
				},
			},
		});
	});

	it("loads dedicated analytics route translations", async () => {
		const translations = await loadRouteTranslations("en");

		expect(translations.en).toMatchObject({
			analytics: {
				layout: {
					title: "Analytics",
				},
			},
		});
	});

	it("loads dedicated today route translations", async () => {
		const translations = await loadRouteTranslations("en");

		expect(translations.en).toMatchObject({
			today: {
				briefing: {
					title: "Manager Daily Briefing",
				},
			},
		});
	});

	it("leaves the mailer's emails namespace out of the complete server catalog", async () => {
		const translations = await loadRouteTranslations("en");

		expect(translations.en).not.toHaveProperty("emails");
		expect(translations.en).not.toHaveProperty(["emails:emails"]);
	});

	it("loads the emails namespace only when the mailer asks for it", async () => {
		const translations = await loadNamespaces("en", ["emails"], { strict: true });

		expect(translations.en).toMatchObject({ emails: { common: { greeting: "Hi {name}," } } });
		expect(() => canonicalizeNamespaces(["common", "emails"])).toThrow(
			"Unsupported translation namespace: emails",
		);
	});

	it("caches bundled translations with the max cache profile", async () => {
		await loadRouteTranslations("en");

		expect(mockState.cacheLife).toHaveBeenCalledWith("max");
	});
});

describe("translation namespace merging", () => {
	it("rejects namespace import failures in strict mode", async () => {
		const importError = new Error("broken translation bundle");

		await expect(
			loadNamespaceImport(
				"common",
				"en",
				async () => {
					throw importError;
				},
				{ strict: true },
			),
		).rejects.toBe(importError);
	});

	it("returns empty namespace data for import failures by default", async () => {
		const importError = new Error("broken translation bundle");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			await expect(
				loadNamespaceImport("common", "en", async () => {
					throw importError;
				}),
			).resolves.toEqual({ ns: "common", data: {} });
			expect(warn).toHaveBeenCalledWith(
				"Failed to load namespace common for en:",
				importError,
			);
		} finally {
			warn.mockRestore();
		}
	});

	it("deep merges split settings namespaces without overwriting sibling groups", () => {
		const merged = mergeTreeTranslations([
			{
				settings: {
					enterprise: {
						email: {
							title: "Email Configuration",
						},
					},
				},
			},
			{
				settings: {
					holidays: {
						title: "Holidays",
					},
				},
			},
		]);

		expect(merged).toEqual({
			settings: {
				enterprise: {
					email: {
						title: "Email Configuration",
					},
				},
				holidays: {
					title: "Holidays",
				},
			},
		});
	});
});
