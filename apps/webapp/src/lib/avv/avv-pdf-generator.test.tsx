import { expect, it } from "vitest";
import { validateOrganizationProfile } from "@/lib/organization/profile";
import {
	avvPdfText,
	fullAvvProfile,
	longAvvProfile,
	minimalAvvProfile as minimal,
	nonLatinAvvProfiles,
} from "./avv-pdf.test.fixture";
import { exportAvvToPDF } from "./avv-pdf-generator";

it.each(nonLatinAvvProfiles)(
	"preserves the exact non-Latin legal identity and every registered address row for $country",
	async (profile) => {
		const text = (await avvPdfText(await exportAvvToPDF(profile))).replace(
			/\s+/gu,
			"",
		);
		for (const value of [
			profile.legalCompanyName,
			profile.addressLine1,
			profile.addressLine2,
			profile.postalCode,
			profile.city,
			profile.stateOrRegion,
			profile.country,
		]) {
			expect(text).toContain(value.replace(/\s+/gu, ""));
		}
	},
);

it("preserves Latin text when a new download follows a Cyrillic document with composite glyphs", async () => {
	await exportAvvToPDF(nonLatinAvvProfiles[0]);
	const text = await avvPdfText(await exportAvvToPDF(minimal));
	expect(text).toContain("Umami Creative Legal GmbH");
	expect(text).toContain("Example Street 7");
});

it("refuses an unrenderable character instead of silently damaging a valid saved legal identity", async () => {
	const profile = { ...minimal, legalCompanyName: "Example 😀 Ltd" };
	expect(validateOrganizationProfile(profile).ok).toBe(true);
	await expect(exportAvvToPDF(profile)).rejects.toThrow(
		"The AVV fonts cannot render U+1F600. Your profile has not been changed. Contact support to add font coverage.",
	);
});

it("exports the legal company and registered address without optional labels or the display name", async () => {
	const pdf = Buffer.from(await exportAvvToPDF(minimal));
	const text = (await avvPdfText(pdf)).replace(/\s+/g, " ");
	expect(text).toContain("Umami Creative Legal GmbH");
	for (const line of ["Example Street 7", "10115 Berlin", "DE"])
		expect(text).toContain(line);
	expect(text).not.toContain(minimal.displayName);
	expect(text).not.toContain("USt-IdNr.");
	expect(text).toContain("Scaleway");
	expect(text).toContain("Firebase Cloud Messaging");
	expect(text).toContain("PostHog");
	expect(text).not.toContain("\\u00a7");
});

it("refuses incomplete identity even when the public exporter is invoked directly", async () => {
	await expect(
		exportAvvToPDF({ ...minimal, legalCompanyName: "  " }),
	).rejects.toThrow("incomplete");
});

it("includes optional VAT and every supplied registered address row without a verified claim", async () => {
	const text = await avvPdfText(await exportAvvToPDF(fullAvvProfile));
	for (const value of [
		"Building B, Floor 2",
		"Berlin region",
		"USt-IdNr.: DE123456789",
	])
		expect(text).toContain(value);
	expect(text).not.toMatch(/verified|verifiziert/i);
});

it("wraps maximum-length party details across physical pages while retaining the agreement and correct page totals", async () => {
	const pdf = Buffer.from(await exportAvvToPDF(longAvvProfile));
	const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
	const text = await avvPdfText(pdf);
	expect(pages).toBeGreaterThan(2);
	for (const ending of [
		"LegalEnd GmbH",
		"StreetEnd 42",
		"BuildingEnd",
		"CityEnd",
		"RegionEnd",
		"DE123456789",
	])
		expect(text).toContain(ending);
	for (let page = 1; page <= pages; page++)
		expect(text).toContain(`Seite ${page} von ${pages}`);
	for (const term of [
		"Gegenstand und Dauer",
		"Art und Zweck",
		"Kategorien betroffener",
		"Kategorien personenbezogener",
		"Technische und organisatorische",
		"Rechte und Pflichten",
		"Pflichten des Auftragnehmers",
		"Einsatz von Unterauftragnehmern",
		"Löschung und Rückgabe",
		"Scaleway",
		"Firebase Cloud Messaging",
		"PostHog",
	])
		expect(text).toContain(term);
});

it("exports a country without postal codes and regenerates after an address changes", async () => {
	const hongKong = {
		...minimal,
		country: "HK",
		city: "Hong Kong",
		postalCode: "",
	};
	const first = await avvPdfText(await exportAvvToPDF(hongKong));
	const second = await avvPdfText(
		await exportAvvToPDF({ ...hongKong, addressLine1: "Changed Street 8" }),
	);
	expect(first).toContain("Example Street 7");
	expect(second).toContain("Changed Street 8");
	expect(second).not.toContain("Example Street 7");
});
