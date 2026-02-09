/**
 * AVV (Auftragsverarbeitungsvertrag) PDF Generator
 * Generates a GDPR Art. 28 compliant Data Processing Agreement
 * Uses @react-pdf/renderer (dynamically imported to reduce bundle size)
 *
 * SECURITY: Authorization must be verified by the caller before invoking these functions.
 * The settings/avv page.tsx enforces BILLING_ENABLED + owner/admin role checks.
 */

const styleDefinitions = {
	page: {
		padding: 50,
		fontSize: 10,
		fontFamily: "Helvetica",
		lineHeight: 1.6,
	},
	title: {
		fontSize: 18,
		marginBottom: 8,
		fontWeight: "bold" as const,
		textAlign: "center" as const,
	},
	subtitle: {
		fontSize: 11,
		marginBottom: 25,
		textAlign: "center" as const,
		color: "#666666",
	},
	sectionTitle: {
		fontSize: 12,
		fontWeight: "bold" as const,
		marginTop: 18,
		marginBottom: 8,
	},
	paragraph: {
		marginBottom: 8,
		textAlign: "justify" as const,
	},
	listItem: {
		marginLeft: 20,
		marginBottom: 4,
	},
	partyBox: {
		padding: 12,
		marginBottom: 15,
		border: "1pt solid #CCCCCC",
		backgroundColor: "#F8F8F8",
	},
	partyLabel: {
		fontWeight: "bold" as const,
		marginBottom: 4,
	},
	footer: {
		position: "absolute" as const,
		bottom: 30,
		left: 50,
		right: 50,
		textAlign: "center" as const,
		fontSize: 8,
		color: "#999999",
	},
};

export async function exportAvvToPDF(organizationName: string): Promise<Uint8Array> {
	const { Document, Page, pdf, StyleSheet, Text, View } = await import("@react-pdf/renderer");

	const styles = StyleSheet.create(styleDefinitions);
	const today = new Date().toLocaleDateString("de-DE", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const AvvDocument = () => (
		<Document>
			{/* Page 1 */}
			<Page size="A4" style={styles.page}>
				<Text style={styles.title}>Auftragsverarbeitungsvertrag</Text>
				<Text style={styles.subtitle}>
					gem\u00e4\u00df Art. 28 Datenschutz-Grundverordnung (DSGVO)
				</Text>

				<Text style={{ ...styles.paragraph, marginBottom: 15 }}>zwischen</Text>

				<View style={styles.partyBox}>
					<Text style={styles.partyLabel}>Auftraggeber (Verantwortlicher):</Text>
					<Text>{organizationName}</Text>
					<Text style={{ fontSize: 9, color: "#666666", marginTop: 4 }}>
						- nachfolgend &quot;Auftraggeber&quot; genannt -
					</Text>
				</View>

				<Text style={{ ...styles.paragraph, textAlign: "center" as const, marginBottom: 15 }}>
					und
				</Text>

				<View style={styles.partyBox}>
					<Text style={styles.partyLabel}>Auftragnehmer (Auftragsverarbeiter):</Text>
					<Text>Umami Creative GmbH</Text>
					<Text>Bismarckstra\u00dfe 9</Text>
					<Text>91054 Erlangen, Bayern</Text>
					<Text>Deutschland</Text>
					<Text style={{ fontSize: 9, color: "#666666", marginTop: 4 }}>
						- nachfolgend &quot;Auftragnehmer&quot; genannt -
					</Text>
				</View>

				{/* --- Section 1 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 1 Gegenstand und Dauer des Auftrags
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer verarbeitet personenbezogene Daten im Auftrag des
					Auftraggebers im Rahmen der Bereitstellung der SaaS-Plattform
					&quot;Z8&quot; f\u00fcr Zeiterfassung und Mitarbeiterverwaltung. Die
					Verarbeitung erfolgt ausschlie\u00dflich auf dokumentierte Weisung des
					Auftraggebers.
				</Text>
				<Text style={styles.paragraph}>
					Dieser Vertrag beginnt mit Aufnahme der Nutzung der Dienste und endet
					automatisch mit Beendigung des Hauptvertrags.
				</Text>

				{/* --- Section 2 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 2 Art und Zweck der Verarbeitung
				</Text>
				<Text style={styles.paragraph}>
					Die Verarbeitung umfasst die Erhebung, Speicherung, Ver\u00e4nderung,
					Abfrage, \u00dcbermittlung und L\u00f6schung personenbezogener Daten im
					Rahmen folgender T\u00e4tigkeiten:
				</Text>
				<Text style={styles.listItem}>
					\u2022 Arbeitszeiterfassung und -auswertung
				</Text>
				<Text style={styles.listItem}>
					\u2022 Urlaubs- und Abwesenheitsverwaltung
				</Text>
				<Text style={styles.listItem}>
					\u2022 Schichtplanung und Personalverwaltung
				</Text>
				<Text style={styles.listItem}>
					\u2022 Berichterstattung und Datenexport
				</Text>

				{/* --- Section 3 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 3 Kategorien betroffener Personen
				</Text>
				<Text style={styles.listItem}>
					\u2022 Besch\u00e4ftigte des Auftraggebers
				</Text>
				<Text style={styles.listItem}>
					\u2022 Administratoren und F\u00fchrungskr\u00e4fte
				</Text>
				<Text style={styles.listItem}>
					\u2022 Tempor\u00e4re und freie Mitarbeiter
				</Text>

				{/* --- Section 4 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 4 Kategorien personenbezogener Daten
				</Text>
				<Text style={styles.listItem}>
					\u2022 Stammdaten (Name, E-Mail-Adresse, Personalnummer)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Arbeitszeitdaten (Zeitstempel, Pausen, \u00dcberstunden)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Abwesenheitsdaten (Urlaub, Krankheit, Antr\u00e4ge)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Organisationsdaten (Team, Position, Standort)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Qualifikationsdaten (sofern aktiviert)
				</Text>

				<Text style={styles.footer}>
					Auftragsverarbeitungsvertrag \u2013 Seite 1 von 2 \u2013 Erstellt am{" "}
					{today}
				</Text>
			</Page>

			{/* Page 2 */}
			<Page size="A4" style={styles.page}>
				{/* --- Section 5 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 5 Technische und organisatorische Ma\u00dfnahmen (Art. 32 DSGVO)
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer hat folgende Ma\u00dfnahmen zum Schutz
					personenbezogener Daten getroffen:
				</Text>
				<Text style={styles.listItem}>
					\u2022 Verschl\u00fcsselung der Daten\u00fcbertragung (TLS 1.3)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Verschl\u00fcsselung gespeicherter Daten (AES-256)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Mehrstufige Zugriffskontrolle und rollenbasierte Berechtigungen
				</Text>
				<Text style={styles.listItem}>
					\u2022 Zwei-Faktor-Authentifizierung (TOTP, Passkeys)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Regelm\u00e4\u00dfige Sicherheitsupdates und Patches
				</Text>
				<Text style={styles.listItem}>
					\u2022 T\u00e4gliche verschl\u00fcsselte Datensicherungen
				</Text>
				<Text style={styles.listItem}>
					\u2022 Protokollierung sicherheitsrelevanter Ereignisse (Audit-Log)
				</Text>
				<Text style={styles.listItem}>
					\u2022 Physische Zugangskontrollen im Rechenzentrum
				</Text>

				{/* --- Section 6 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 6 Rechte und Pflichten des Auftraggebers
				</Text>
				<Text style={styles.paragraph}>
					Der Auftraggeber ist f\u00fcr die Einhaltung der
					datenschutzrechtlichen Bestimmungen verantwortlich, insbesondere
					f\u00fcr die Rechtm\u00e4\u00dfigkeit der Daten\u00fcbermittlung an
					den Auftragnehmer sowie die Wahrung der Rechte der betroffenen
					Personen. Der Auftraggeber hat das Recht, die Einhaltung der
					Bestimmungen dieses Vertrages beim Auftragnehmer zu \u00fcberpr\u00fcfen.
				</Text>

				{/* --- Section 7 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 7 Pflichten des Auftragnehmers
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer verarbeitet personenbezogene Daten ausschlie\u00dflich
					auf dokumentierte Weisung des Auftraggebers und informiert diesen
					unverz\u00fcglich, falls eine Weisung gegen Datenschutzvorschriften
					verst\u00f6\u00dft. Alle zur Verarbeitung befugten Personen sind zur
					Vertraulichkeit verpflichtet.
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer unterst\u00fctzt den Auftraggeber bei der
					Erf\u00fcllung seiner Pflichten gem\u00e4\u00df Art. 32\u201336 DSGVO
					sowie bei der Beantwortung von Antr\u00e4gen betroffener Personen
					gem\u00e4\u00df Art. 12\u201322 DSGVO.
				</Text>

				{/* --- Section 8 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 8 Einsatz von Unterauftragnehmern (Subprozessoren)
				</Text>
				<Text style={styles.paragraph}>
					Der Auftraggeber erteilt dem Auftragnehmer die allgemeine Genehmigung
					zur Beauftragung von Unterauftragnehmern gem\u00e4\u00df Art. 28
					Abs. 2 DSGVO. Der Auftragnehmer informiert den Auftraggeber \u00fcber
					jede beabsichtigte \u00c4nderung in Bezug auf die Hinzuziehung oder
					Ersetzung von Unterauftragnehmern.
				</Text>
				<Text style={styles.paragraph}>
					Derzeit eingesetzte Unterauftragnehmer:
				</Text>
				<Text style={styles.listItem}>
					\u2022 Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen,
					Deutschland \u2013 Hosting und Infrastruktur
				</Text>
				<Text style={{ ...styles.paragraph, marginTop: 8 }}>
					Es werden keine weiteren Subprozessoren f\u00fcr die Verarbeitung
					personenbezogener Daten eingesetzt.
				</Text>

				{/* --- Section 9 --- */}
				<Text style={styles.sectionTitle}>
					\u00a7 9 L\u00f6schung und R\u00fcckgabe personenbezogener Daten
				</Text>
				<Text style={styles.paragraph}>
					Nach Beendigung der vertraglichen Leistungen l\u00f6scht der
					Auftragnehmer alle im Auftrag verarbeiteten personenbezogenen Daten
					einschlie\u00dflich vorhandener Kopien, sofern keine gesetzliche
					Aufbewahrungspflicht besteht. Auf Wunsch des Auftraggebers wird vor
					der L\u00f6schung ein vollst\u00e4ndiger Datenexport bereitgestellt.
				</Text>
				<Text style={styles.paragraph}>
					Die L\u00f6schung wird dem Auftraggeber schriftlich best\u00e4tigt.
				</Text>

				<Text style={styles.footer}>
					Auftragsverarbeitungsvertrag \u2013 Seite 2 von 2 \u2013 Erstellt am{" "}
					{today}
				</Text>
			</Page>
		</Document>
	);

	const blob = await pdf(<AvvDocument />).toBlob();
	return new Uint8Array(await blob.arrayBuffer());
}

export function generateAvvFilename(organizationName: string): string {
	const sanitized = organizationName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
	const date = new Date().toISOString().split("T")[0];
	return `avv-${sanitized}-${date}.pdf`;
}
