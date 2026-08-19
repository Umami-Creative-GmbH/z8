import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const locales = [
	"de",
	"el",
	"en",
	"es",
	"fr",
	"gsw",
	"it",
	"pl",
	"pt",
	"tr",
] as const;
const requiredKeys = [
	"timeTracking.correction.clockInTime",
	"timeTracking.correction.clockOutTime",
	"timeTracking.correction.errors.noChanges",
	"timeTracking.correction.success.applied",
	"timeTracking.workLocation",
	"timeTracking.workLocationHome",
	"timeTracking.workLocationOffice",
	"timeTracking.workLocationOther",
	"timeTracking.workLocationRemote",
] as const;

function getMessage(catalog: Record<string, unknown>, key: string): unknown {
	return key.split(".").reduce<unknown>((value, segment) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return undefined;
		}
		return (value as Record<string, unknown>)[segment];
	}, catalog);
}

describe("time correction i18n catalogs", () => {
	it.each(locales)(
		"provides every correction control message in %s",
		(locale) => {
			const catalog = JSON.parse(
				readFileSync(
					join(process.cwd(), "messages/timeTracking", `${locale}.json`),
					"utf8",
				),
			) as Record<string, unknown>;

			for (const key of requiredKeys) {
				expect(getMessage(catalog, key), `${locale}: ${key}`).toEqual(
					expect.any(String),
				);
			}
		},
	);
});
