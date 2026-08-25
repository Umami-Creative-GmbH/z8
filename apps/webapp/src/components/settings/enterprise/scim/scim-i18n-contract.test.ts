import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const locales = ["en", "de", "es", "fr", "it", "gsw", "el", "pl", "pt", "tr"] as const;
const catalogPath = (locale: (typeof locales)[number]) =>
	resolve(process.cwd(), `messages/settings/enterprise/${locale}.json`);
const sourcePath = (file: string) => resolve(process.cwd(), "src/components/settings/enterprise/scim", file);

function flatten(value: unknown, prefix = ""): string[] {
	if (typeof value === "string") return [prefix];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

function scimCatalog(locale: (typeof locales)[number]) {
	const catalog = JSON.parse(readFileSync(catalogPath(locale), "utf8"));
	return catalog.settings.enterprise.identity.scim;
}

describe("managed SCIM i18n contract", () => {
	it("provides the complete SCIM key set in every enterprise locale", () => {
		const expected = flatten(scimCatalog("en")).sort();

		for (const locale of locales) {
			expect(flatten(scimCatalog(locale)).sort(), locale).toEqual(expected);
		}
	});

	it("catalogues every static SCIM component reference without legacy fallback copy", () => {
		const source = [
			"scim-step.tsx",
			"scim-credential-list.tsx",
			"scim-destructive-dialogs.tsx",
			"scim-events-list.tsx",
			"scim-one-time-credential-dialog.tsx",
			"use-scim-admin-controller.ts",
		]
			.map((file) => readFileSync(sourcePath(file), "utf8"))
			.concat(
				readFileSync(
					resolve(
						process.cwd(),
						"src/components/settings/enterprise/domains-branding-tabs.tsx",
					),
					"utf8",
				),
			)
			.join("\n");
		const references = [...source.matchAll(/settings\.enterprise\.identity\.scim\.[A-Za-z0-9_.-]+/g)]
			.map((match) => match[0].replace("settings.enterprise.identity.", ""))
			.filter((key) => !key.endsWith(".status."));
		const keys = new Set(flatten({ scim: scimCatalog("en") }));

		for (const key of references) expect(keys).toContain(key);
		expect(keys).not.toContain("scim.action.generateToken");
		expect(keys).not.toContain("scim.action.copyToken");
		expect(keys).not.toContain("scim.tokenShownOnce");
		expect(source).not.toMatch(/Generate (?:a )?(?:provisioning )?token|migration unavailable/i);
		expect(source).not.toMatch(/SCIM provisioning is temporarily unavailable/i);
	});
});
