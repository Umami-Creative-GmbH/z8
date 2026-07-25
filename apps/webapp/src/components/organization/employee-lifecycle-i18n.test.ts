import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webappDir = join(import.meta.dirname, "../../..");
const messagesDir = join(webappDir, "messages/settings/people");
const locales = [
	"en",
	"de",
	"es",
	"fr",
	"gsw",
	"it",
	"pl",
	"pt",
	"tr",
	"el",
] as const;

const approvedEnglish = {
	"settings.employees.draftActions.cancel": "Cancel",
	"settings.employees.draftActions.delete": "Delete draft",
	"settings.employees.draftActions.deleteConfirm": "Delete draft permanently",
	"settings.employees.draftActions.deleteDescription":
		"This permanently deletes the prepared employee data and cancels the pending invitation. No employee history will be deleted.",
	"settings.employees.draftActions.deleteError":
		"Failed to delete employee draft",
	"settings.employees.draftActions.deleteTitle": "Delete employee draft?",
	"settings.employees.draftActions.deleting": "Deleting draft...",
	"settings.employees.draftActions.resend": "Resend invitation",
	"settings.employees.draftActions.resendError": "Failed to resend invitation",
	"settings.employees.draftActions.resendSuccess":
		"Invitation resent successfully",
	"settings.employees.draftActions.resending": "Resending invitation...",
	"settings.employees.lifecycle.actionsLabel": "Employee actions for {name}",
	"settings.employees.lifecycle.deactivate": "Deactivate",
	"settings.employees.lifecycle.deactivateDescription":
		"This suspends access to this organization and ends sessions currently using it. Employee history is retained.",
	"settings.employees.lifecycle.deactivateError":
		"Failed to deactivate employee",
	"settings.employees.lifecycle.deactivateSuccess": "Employee deactivated",
	"settings.employees.lifecycle.deactivateTitle": "Deactivate employee?",
	"settings.employees.lifecycle.deactivating": "Deactivating...",
	"settings.employees.lifecycle.deactivatingStatus": "Deactivating employee",
	"settings.employees.lifecycle.finalOwnerDeactivateGuidance":
		"Assign and activate another approved owner before deactivating this employee.",
	"settings.employees.lifecycle.finalOwnerRemoveGuidance":
		"Assign and activate another approved owner before removing this employee's access.",
	"settings.employees.lifecycle.reactivate": "Reactivate",
	"settings.employees.lifecycle.reactivateDescription":
		"This restores access to this organization using the existing employee record.",
	"settings.employees.lifecycle.reactivateError":
		"Failed to reactivate employee",
	"settings.employees.lifecycle.reactivateSuccess": "Employee reactivated",
	"settings.employees.lifecycle.reactivateTitle": "Reactivate employee?",
	"settings.employees.lifecycle.reactivating": "Reactivating...",
	"settings.employees.lifecycle.reactivatingStatus": "Reactivating employee",
	"settings.employees.lifecycle.reinviteRequired":
		"This employee no longer has organization membership. Send a new invitation to restore access.",
	"settings.employees.lifecycle.removeAccess": "Remove access",
	"settings.employees.lifecycle.removeDescription":
		"This removes organization membership and ends organization sessions. Time records, absences, balances, employment history, and audits are retained.",
	"settings.employees.lifecycle.removeError":
		"Failed to remove organization access",
	"settings.employees.lifecycle.removeSuccess": "Organization access removed",
	"settings.employees.lifecycle.removeTitle": "Remove organization access?",
	"settings.employees.lifecycle.removing": "Removing access...",
	"settings.employees.lifecycle.removingStatus": "Removing organization access",
} as const;

const coreDescriptions = [
	"settings.employees.draftActions.deleteDescription",
	"settings.employees.lifecycle.deactivateDescription",
	"settings.employees.lifecycle.finalOwnerDeactivateGuidance",
	"settings.employees.lifecycle.finalOwnerRemoveGuidance",
	"settings.employees.lifecycle.reactivateDescription",
	"settings.employees.lifecycle.reinviteRequired",
	"settings.employees.lifecycle.removeDescription",
] as const;

const supersededKeys = [
	"settings.employees.lifecycle.reinviteGuidance",
	"settings.employees.lifecycle.remove",
] as const;

function readCatalog(
	locale: (typeof locales)[number],
): Record<string, unknown> {
	return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
}

function getMessage(catalog: Record<string, unknown>, key: string): unknown {
	return key.split(".").reduce<unknown>((value, segment) => {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return undefined;
		return (value as Record<string, unknown>)[segment];
	}, catalog);
}

function getPlaceholders(message: string): string[] {
	return Array.from(
		message.matchAll(/\{([a-zA-Z][\w]*)\}/g),
		(match) => match[1],
	).sort();
}

describe("employee lifecycle i18n catalogs", () => {
	it("keeps the catalog contract aligned with every lifecycle UI key", () => {
		const sourceFiles = [
			join(import.meta.dirname, "employee-lifecycle-actions.tsx"),
			join(
				webappDir,
				"src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.tsx",
			),
			join(
				webappDir,
				"src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx",
			),
		];
		const usedKeys = sourceFiles.flatMap((file) =>
			Array.from(
				readFileSync(file, "utf8").matchAll(
					/t\(\s*"(settings\.employees\.(?:lifecycle|draftActions)\.[^"]+)"/g,
				),
				(match) => match[1],
			),
		);

		expect([...new Set(usedKeys)].sort()).toEqual(
			Object.keys(approvedEnglish).sort(),
		);
	});

	it("keeps the approved English wording exact", () => {
		const catalog = readCatalog("en");

		for (const [key, value] of Object.entries(approvedEnglish)) {
			expect(getMessage(catalog, key), key).toBe(value);
		}
	});

	it.each(locales)("provides every lifecycle message in %s", (locale) => {
		const catalog = readCatalog(locale);

		for (const [key, english] of Object.entries(approvedEnglish)) {
			const message = getMessage(catalog, key);
			expect(message, `${locale}: ${key}`).toEqual(expect.any(String));
			expect(message, `${locale}: ${key}`).not.toBe("");
			expect(
				getPlaceholders(message as string),
				`${locale}: ${key} placeholders`,
			).toEqual(getPlaceholders(english));
		}
	});

	it.each(
		locales,
	)("does not retain superseded lifecycle keys in %s", (locale) => {
		const catalog = readCatalog(locale);

		for (const key of supersededKeys) {
			expect(getMessage(catalog, key), `${locale}: ${key}`).toBeUndefined();
		}
	});

	it.each(
		locales.filter((locale) => locale !== "en"),
	)("translates core lifecycle descriptions in %s", (locale) => {
		const catalog = readCatalog(locale);

		for (const key of coreDescriptions) {
			expect(getMessage(catalog, key), `${locale}: ${key}`).not.toBe(
				approvedEnglish[key],
			);
		}
	});
});
