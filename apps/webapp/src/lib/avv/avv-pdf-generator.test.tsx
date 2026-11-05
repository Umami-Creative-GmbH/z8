import { expect, it } from "vitest";
import { pdfTexts } from "@/lib/time-tracking/kiosk/badge-pdf.test.fixture";
import {
	fullAvvProfile,
	longAvvProfile,
	minimalAvvProfile as minimal,
} from "./avv-pdf.test.fixture";
import { exportAvvToPDF } from "./avv-pdf-generator";

it("exports the legal company and registered address without optional labels or the display name", async () => {
	const pdf = Buffer.from(await exportAvvToPDF(minimal));
	const texts = pdfTexts(pdf);
	const text = texts.join("").replace(/\s+/g, " ");
	expect(texts).toContain("Umami Creative Legal GmbH");
	for (const line of ["Example Street 7", "10115 Berlin", "DE"])
		expect(text).toContain(line);
	expect(texts).not.toContain("Umami");
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
	const text = pdfTexts(Buffer.from(await exportAvvToPDF(fullAvvProfile))).join(
		"",
	);
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
	const text = pdfTexts(pdf).join("");
	const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
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
	const first = pdfTexts(Buffer.from(await exportAvvToPDF(hongKong))).join("");
	const second = pdfTexts(
		Buffer.from(
			await exportAvvToPDF({ ...hongKong, addressLine1: "Changed Street 8" }),
		),
	).join("");
	expect(first).toContain("Example Street 7");
	expect(second).toContain("Changed Street 8");
	expect(second).not.toContain("Example Street 7");
});
