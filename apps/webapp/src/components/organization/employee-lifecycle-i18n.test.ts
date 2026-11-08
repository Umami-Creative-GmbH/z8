import { readdirSync, readFileSync } from "node:fs";
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
	// Deactivate's confirmation is the preview dialog (#1440), whose keys live in
	// `deactivation-preview-dialog.tsx`; the old title, description and status
	// line are no longer used, and its pending label is used there.
	"settings.employees.lifecycle.deactivateError":
		"Failed to deactivate employee",
	"settings.employees.lifecycle.deactivateSuccess": "Employee deactivated",
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
	// Member removal is a deactivation (#1629, Organization ADR 0011).
	"settings.employees.lifecycle.removeEndsEmployment":
		"Removing them also ends their employment, like a deactivation: their future shifts become open, their later absences are cancelled and their grants end. To choose replacement managers for their reports, use Deactivate instead.",
	"settings.employees.lifecycle.removeError":
		"Failed to remove organization access",
	"settings.employees.lifecycle.removeSuccess": "Organization access removed",
	"settings.employees.lifecycle.removeTitle": "Remove organization access?",
	"settings.employees.lifecycle.removing": "Removing access...",
	"settings.employees.lifecycle.removingStatus": "Removing organization access",
} as const;

const coreDescriptions = [
	"settings.employees.draftActions.deleteDescription",
	"settings.employees.lifecycle.finalOwnerDeactivateGuidance",
	"settings.employees.lifecycle.finalOwnerRemoveGuidance",
	"settings.employees.lifecycle.reactivateDescription",
	"settings.employees.lifecycle.reinviteRequired",
	"settings.employees.lifecycle.removeDescription",
	"settings.employees.lifecycle.removeEndsEmployment",
] as const;

/**
 * What ends with the employment (#1624) and that removal ends it (#1629): in
 * every locale file of the namespace, translated.
 */
const employmentEndingEnglish = {
	"settings.employees.lifecycle.deactivationPreview.documentRequests":
		"{count, plural, one {# open document request is cancelled} other {# open document requests are cancelled}}",
	"settings.employees.lifecycle.reactivationChecklist.groups.documentRequests":
		"Cancelled document requests",
	"settings.employees.lifecycle.reactivationChecklist.items.documentRequests":
		"{count, plural, one {# open document request was cancelled; request it again in the personnel file} other {# open document requests were cancelled; request them again in the personnel file}}",
	"settings.employees.lifecycle.removeEndsEmployment":
		approvedEnglish["settings.employees.lifecycle.removeEndsEmployment"],
} as const;

/** The component that gives each of them its English default. */
const employmentEndingSources: Record<keyof typeof employmentEndingEnglish, string> = {
	"settings.employees.lifecycle.deactivationPreview.documentRequests":
		"deactivation-preview-sections.tsx",
	"settings.employees.lifecycle.reactivationChecklist.groups.documentRequests":
		"reactivation-checklist.tsx",
	"settings.employees.lifecycle.reactivationChecklist.items.documentRequests":
		"reactivation-checklist.tsx",
	"settings.employees.lifecycle.removeEndsEmployment": "employee-lifecycle-actions.tsx",
};

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
		Object.keys(employmentEndingEnglish),
	)("translates %s in every locale of the namespace (#1624, #1629)", (key) => {
		const english = employmentEndingEnglish[key as keyof typeof employmentEndingEnglish];
		const files = readdirSync(messagesDir).filter((file) => file.endsWith(".json"));
		expect(files.length).toBeGreaterThanOrEqual(18);
		for (const file of files) {
			const catalog = JSON.parse(readFileSync(join(messagesDir, file), "utf8"));
			const message = getMessage(catalog, key);
			expect(message, `${file}: ${key}`).toEqual(expect.any(String));
			expect(message, `${file}: ${key}`).not.toBe("");
			if (file === "en.json") {
				expect(message, `${file}: ${key}`).toBe(english);
			} else {
				expect(message, `${file}: ${key}`).not.toBe(english);
			}
		}
	});

	it.each(
		Object.entries(employmentEndingSources),
	)("keeps the English default of %s in code equal to the catalog", (key, source) => {
		const code = readFileSync(join(import.meta.dirname, source), "utf8");
		const defaults = Array.from(
			code.matchAll(/t\(\s*"([^"]+)",\s*"([^"]*)"/g),
			(match) => [match[1], match[2]] as const,
		).filter(([used]) => used === key);
		expect(defaults.map(([, fallback]) => fallback)).toEqual([
			employmentEndingEnglish[key as keyof typeof employmentEndingEnglish],
		]);
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
