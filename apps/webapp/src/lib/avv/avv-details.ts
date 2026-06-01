const subprocessors = [
	{
		providerName: "Scaleway SAS",
		displayText: "Scaleway SAS - Hosting und Infrastruktur in der EU",
		pdfText:
			"Scaleway SAS, 8 rue de la Ville l'Évêque, 75008 Paris, Frankreich - Hosting und Infrastruktur in der EU",
	},
	{
		providerName: "PostHog, Inc.",
		displayText:
			"PostHog, Inc. - Produktanalyse, Fehleranalyse und Nutzungsdiagnostik, sofern Telemetrie aktiviert ist",
		pdfText:
			"PostHog, Inc. - Produktanalyse, Fehleranalyse und Nutzungsdiagnostik, sofern Telemetrie aktiviert ist",
	},
] as const;

export const avvHostingDetails = {
	providerName: "Scaleway SAS",
	displayText: "Scaleway SAS in der EU",
	pdfSubprocessorText:
		"Scaleway SAS, 8 rue de la Ville l'Évêque, 75008 Paris, Frankreich - Hosting und Infrastruktur in der EU",
	subprocessors,
} as const;
