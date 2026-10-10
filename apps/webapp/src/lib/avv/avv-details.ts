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
	{
		providerName: "Google Ireland Limited",
		displayText:
			"Google Ireland Limited (Firebase Cloud Messaging) - Zustellung von Push-Benachrichtigungen an die Z8-App, sofern Push in der App aktiviert ist",
		pdfText:
			"Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland (Firebase Cloud Messaging) - Zustellung von Push-Benachrichtigungen an die Z8-App für iOS und Android, sofern Push in der App aktiviert ist. Verarbeitet werden die Gerätekennung (Push-Token) und ein allgemeiner Hinweistext, ohne Inhalte der Benachrichtigung",
	},
] as const;

export const avvHostingDetails = {
	providerName: "Scaleway SAS",
	displayText: "Scaleway SAS in der EU",
	pdfSubprocessorText:
		"Scaleway SAS, 8 rue de la Ville l'Évêque, 75008 Paris, Frankreich - Hosting und Infrastruktur in der EU",
	subprocessors,
} as const;
