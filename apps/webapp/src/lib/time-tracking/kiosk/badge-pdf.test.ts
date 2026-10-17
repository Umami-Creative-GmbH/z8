/**
 * #1364: the printable kiosk badge. What a person reads on the printed page and
 * what a scanner reads from its QR code.
 */
import { describe, expect, it, vi } from "vitest";
import { pdfQrCodeText, pdfTexts } from "./badge-pdf.test.fixture";

vi.mock("server-only", () => ({}));

const { renderKioskBadgePdf } = await import("./badge-pdf");

const credential = "K8B0123456789ABCDEFGHJKMNPQRSTVWX0123456789ABCDEFGHJKMNPQRS";

describe("renderKioskBadgePdf", () => {
	vi.setConfig({ testTimeout: 30_000 });

	it("prints the employee's name, the organization and a QR code that decodes to the credential", async () => {
		const pdf = await renderKioskBadgePdf({
			employeeName: "Jürgen Weiß",
			organizationName: "Bäckerei Müller GmbH",
			credential,
			labels: {
				title: "Kiosk-Ausweis",
				instructions: "Ausschneiden und sicher aufbewahren.",
			},
		});

		expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
		const texts = pdfTexts(pdf);
		expect(texts).toContain("Jürgen Weiß");
		expect(texts).toContain("Bäckerei Müller GmbH");
		expect(texts.join(" ")).toContain("Ausschneiden und sicher aufbewahren.");
		expect(pdfQrCodeText(pdf)).toBe(credential);
	});

	it("prints no credential as text: only the QR code carries it", async () => {
		const pdf = await renderKioskBadgePdf({
			employeeName: "Ada Lovelace",
			organizationName: "Analytical Engines",
			credential,
			labels: { title: "Kiosk badge", instructions: "Cut it out." },
		});

		expect(pdfTexts(pdf).join(" ")).not.toContain(credential.slice(3, 20));
	});
});
