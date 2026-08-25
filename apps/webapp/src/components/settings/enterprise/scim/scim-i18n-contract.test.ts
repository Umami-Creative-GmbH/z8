import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import extractor from "../../../../../tolgee-extractor.mjs";

const locales = ALL_LANGUAGES;
const connectionStatuses = [
	"active-unverified",
	"creating",
	"creation_failed",
	"decommissioned",
	"decommissioning",
	"disconnected",
	"refreshing",
	"revoking",
	"rotating",
	"verified",
] as const;
const credentialStatuses = ["active", "revoked"] as const;
const catalogPath = (locale: (typeof locales)[number]) =>
	resolve(process.cwd(), `messages/settings/enterprise/${locale}.json`);
const sourcePath = (file: string) =>
	resolve(process.cwd(), "src/components/settings/enterprise/scim", file);

function flatten(value: unknown, prefix = ""): string[] {
	if (typeof value === "string") return [prefix];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) =>
		flatten(child, prefix ? `${prefix}.${key}` : key),
	);
}

function messages(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(messages);
}

function missingKeys(catalog: unknown, references: string[]) {
	const keys = new Set(flatten(catalog));
	return references.filter((key) => !keys.has(key));
}

function scimCatalog(locale: (typeof locales)[number]) {
	return identityCatalog(locale).scim;
}

function identityCatalog(locale: (typeof locales)[number]) {
	return enterpriseCatalog(locale).identity;
}

function enterpriseCatalog(locale: (typeof locales)[number]) {
	const catalog = JSON.parse(readFileSync(catalogPath(locale), "utf8"));
	return catalog.settings.enterprise;
}

describe("managed SCIM i18n contract", () => {
	it("provides the complete SCIM key set in every enterprise locale", () => {
		const expected = flatten(scimCatalog("en")).sort();

		for (const locale of locales) {
			expect(flatten(scimCatalog(locale)).sort(), locale).toEqual(expected);
		}
	});

	it("catalogues every rendered SCIM reference and connection status", () => {
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
			.concat(
				readFileSync(
					resolve(
						process.cwd(),
						"src/components/settings/enterprise/identity-setup-wizard.tsx",
					),
					"utf8",
				),
			)
			.join("\n");
		const staticReferences = [
			...source.matchAll(
				/settings\.enterprise\.(?:identity\.(?:scim(?:\.[A-Za-z0-9_.-]+)?|step\.scim(?:\.[A-Za-z0-9_.-]+)?)|domains\.guidedSetup\.[A-Za-z0-9_.-]+)/g,
			),
		].map((match) => match[0].replace("settings.enterprise.", ""));
		const englishKeys = new Set(flatten(enterpriseCatalog("en")));

		for (const locale of locales) {
			expect(
				missingKeys(enterpriseCatalog(locale), staticReferences),
				locale,
			).toEqual([]);
		}
		expect(englishKeys).not.toContain("identity.scim.action.generateToken");
		expect(englishKeys).not.toContain("identity.scim.action.copyToken");
		expect(englishKeys).not.toContain("identity.scim.tokenShownOnce");
		for (const locale of locales) {
			const toastKeys = Object.keys(identityCatalog(locale).toast);
			expect(toastKeys, locale).not.toContain("scimStatusFailed");
			expect(toastKeys, locale).not.toContain("scimStatusRefreshed");
			expect(toastKeys, locale).not.toContain("scimTokenFailed");
			expect(toastKeys, locale).not.toContain("scimTokenGenerated");
		}
		expect(source).not.toMatch(
			/Generate (?:a )?(?:provisioning )?token|migration unavailable/i,
		);
		expect(source).not.toMatch(/SCIM provisioning is temporarily unavailable/i);
	});

	it("extracts every SCIM status translation from its source", () => {
		const sources = ["scim-step.tsx", "scim-credential-list.tsx"];
		const extractedKeys = sources.flatMap((file) =>
			extractor(readFileSync(sourcePath(file), "utf8"), file).keys.map(
				({ keyName }: { keyName: string }) => keyName,
			),
		);

		expect(extractedKeys).toEqual(
			expect.arrayContaining([
				...connectionStatuses.map(
					(status) => `settings.enterprise.identity.scim.status.${status}`,
				),
				...credentialStatuses.map(
					(status) =>
						`settings.enterprise.identity.scim.credentials.status.${status}`,
				),
			]),
		);
	});

	it("rejects a missing non-English rendered key", () => {
		const germanCatalog = enterpriseCatalog("de");
		const missingGuidedSetupDescription = {
			...germanCatalog,
			domains: {
				...germanCatalog.domains,
				guidedSetup: {
					...germanCatalog.domains.guidedSetup,
					description: undefined,
				},
			},
		};

		expect(
			missingKeys(missingGuidedSetupDescription, [
				"domains.guidedSetup.description",
			]),
		).toEqual(["domains.guidedSetup.description"]);
	});

	it("rejects a missing non-English credential status", () => {
		const germanCatalog = enterpriseCatalog("de");
		const missingRevokedCredentialStatus = {
			...germanCatalog,
			identity: {
				...germanCatalog.identity,
				scim: {
					...germanCatalog.identity.scim,
					credentials: {
						...germanCatalog.identity.scim.credentials,
						status: {
							...germanCatalog.identity.scim.credentials.status,
							revoked: undefined,
						},
					},
				},
			},
		};

		expect(
			missingKeys(missingRevokedCredentialStatus, [
				"identity.scim.credentials.status.revoked",
			]),
		).toEqual(["identity.scim.credentials.status.revoked"]);
	});

	it("does not retain legacy provisioning-token copy in rendered SCIM messages", () => {
		for (const locale of locales) {
			const values = [
				...messages(scimCatalog(locale)),
				identityCatalog(locale).step["scim.description"],
			];

			for (const value of values) {
				expect(value, locale).not.toMatch(
					/provision(?:ing)? token|token.*provision/i,
				);
			}
		}
	});
});
