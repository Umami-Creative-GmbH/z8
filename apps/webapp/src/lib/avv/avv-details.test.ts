import { describe, expect, it } from "vitest";
import { avvHostingDetails } from "./avv-details";

describe("avvHostingDetails", () => {
	it("documents Scaleway as the EU hosting subprocessor", () => {
		expect(avvHostingDetails.providerName).toBe("Scaleway SAS");
		expect(avvHostingDetails.displayText).toContain("Scaleway SAS");
		expect(avvHostingDetails.displayText).toContain("EU");
		expect(avvHostingDetails.pdfSubprocessorText).toContain("8 rue de la Ville l'Évêque");
		expect(avvHostingDetails.pdfSubprocessorText).toContain("Hosting und Infrastruktur in der EU");
		expect(avvHostingDetails.displayText).not.toContain("Hetzner");
		expect(avvHostingDetails.pdfSubprocessorText).not.toContain("Hetzner");
	});

	it("documents PostHog as a conditional telemetry subprocessor", () => {
		expect(avvHostingDetails.subprocessors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					providerName: "PostHog, Inc.",
					displayText: expect.stringContaining("sofern Telemetrie aktiviert ist"),
					pdfText: expect.stringContaining("Produktanalyse, Fehleranalyse und Nutzungsdiagnostik"),
				}),
			]),
		);
	});
});
