/**
 * AVV (Auftragsverarbeitungsvertrag) PDF Generator
 * Generates a GDPR Art. 28 compliant Data Processing Agreement
 * Uses @react-pdf/renderer (dynamically imported to reduce bundle size)
 *
 * SECURITY: Authorization must be verified by the caller before invoking these functions.
 * The supported download calls settings/avv/actions.ts to reload the authorized
 * current profile and enforce BILLING_ENABLED + owner/admin access.
 */

import { Temporal } from "temporal-polyfill";
import {
	type OrganizationProfile,
	validateOrganizationProfile,
} from "@/lib/organization/profile";
import { avvHostingDetails } from "./avv-details";
import { getAvvMissingFields, getRegisteredAddressLines } from "./profile";

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
		// A fixed top keeps dynamically measured footers inside overflow pages.
		top: 800,
		left: 50,
		right: 50,
		textAlign: "center" as const,
		fontSize: 8,
		color: "#999999",
	},
};

export async function exportAvvToPDF(
	profile: OrganizationProfile,
): Promise<Uint8Array> {
	const validation = validateOrganizationProfile(profile);
	if (!validation.ok || getAvvMissingFields(validation.profile).length) {
		throw new Error("Organization profile is incomplete or invalid");
	}
	const controller = validation.profile;
	const [
		{ Document, Page, pdf, StyleSheet, Text, View, Font },
		{ loadAvvControllerFonts },
	] = await Promise.all([import("@react-pdf/renderer"), import("./avv-fonts")]);
	const controllerFontFamily = await loadAvvControllerFonts(
		Font,
		Object.values(controller),
	);

	const styles = StyleSheet.create(styleDefinitions);
	const today = Temporal.Now.plainDateISO("UTC").toLocaleString("de-DE", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	// biome-ignore lint/correctness/noComponentHookFactories: one-shot @react-pdf render over the dynamically imported primitives; it never re-renders.
	const AvvDocument = () => (
		<Document>
			{/* Page 1 */}
			<Page size="A4" style={styles.page}>
				<Text style={styles.title}>Auftragsverarbeitungsvertrag</Text>
				<Text style={styles.subtitle}>
					gemäß Art. 28 Datenschutz-Grundverordnung (DSGVO)
				</Text>

				<Text style={{ ...styles.paragraph, marginBottom: 15 }}>zwischen</Text>

				<View style={styles.partyBox} wrap={false}>
					<Text style={styles.partyLabel}>
						Auftraggeber (Verantwortlicher):
					</Text>
					<Text style={{ fontFamily: controllerFontFamily }}>
						{controller.legalCompanyName}
					</Text>
					{getRegisteredAddressLines(controller).map(({ field, value }) => (
						<Text key={field} style={{ fontFamily: controllerFontFamily }}>
							{value}
						</Text>
					))}
					{controller.vatId && (
						<Text style={{ fontFamily: controllerFontFamily }}>
							USt-IdNr.: {controller.vatId}
						</Text>
					)}
					<Text style={{ fontSize: 9, color: "#666666", marginTop: 4 }}>
						- nachfolgend &quot;Auftraggeber&quot; genannt -
					</Text>
				</View>

				<Text
					style={{
						...styles.paragraph,
						textAlign: "center" as const,
						marginBottom: 15,
					}}
				>
					und
				</Text>

				<View style={styles.partyBox} wrap={false}>
					<Text style={styles.partyLabel}>
						Auftragnehmer (Auftragsverarbeiter):
					</Text>
					<Text>Umami Creative GmbH</Text>
					<Text>Bismarckstraße 9</Text>
					<Text>91054 Erlangen, Bayern</Text>
					<Text>Deutschland</Text>
					<Text style={{ fontSize: 9, color: "#666666", marginTop: 4 }}>
						- nachfolgend &quot;Auftragnehmer&quot; genannt -
					</Text>
				</View>

				{/* --- Section 1 --- */}
				<Text style={styles.sectionTitle}>
					§ 1 Gegenstand und Dauer des Auftrags
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer verarbeitet personenbezogene Daten im Auftrag des
					Auftraggebers im Rahmen der Bereitstellung der SaaS-Plattform
					&quot;Z8&quot; für Zeiterfassung und Mitarbeiterverwaltung. Die
					Verarbeitung erfolgt ausschließlich auf dokumentierte Weisung des
					Auftraggebers.
				</Text>
				<Text style={styles.paragraph}>
					Dieser Vertrag beginnt mit Aufnahme der Nutzung der Dienste und endet
					automatisch mit Beendigung des Hauptvertrags.
				</Text>

				{/* --- Section 2 --- */}
				<Text style={styles.sectionTitle}>
					§ 2 Art und Zweck der Verarbeitung
				</Text>
				<Text style={styles.paragraph}>
					Die Verarbeitung umfasst die Erhebung, Speicherung, Veränderung,
					Abfrage, Übermittlung und Löschung personenbezogener Daten im Rahmen
					folgender Tätigkeiten:
				</Text>
				<Text style={styles.listItem}>
					• Arbeitszeiterfassung und -auswertung
				</Text>
				<Text style={styles.listItem}>
					• Urlaubs- und Abwesenheitsverwaltung
				</Text>
				<Text style={styles.listItem}>
					• Schichtplanung und Personalverwaltung
				</Text>
				<Text style={styles.listItem}>• Berichterstattung und Datenexport</Text>

				{/* --- Section 3 --- */}
				<Text style={styles.sectionTitle}>
					§ 3 Kategorien betroffener Personen
				</Text>
				<Text style={styles.listItem}>• Beschäftigte des Auftraggebers</Text>
				<Text style={styles.listItem}>
					• Administratoren und Führungskräfte
				</Text>
				<Text style={styles.listItem}>• Temporäre und freie Mitarbeiter</Text>

				{/* --- Section 4 --- */}
				<Text style={styles.sectionTitle}>
					§ 4 Kategorien personenbezogener Daten
				</Text>
				<Text style={styles.listItem}>
					• Stammdaten (Name, E-Mail-Adresse, Personalnummer)
				</Text>
				<Text style={styles.listItem}>
					• Arbeitszeitdaten (Zeitstempel, Pausen, Überstunden)
				</Text>
				<Text style={styles.listItem}>
					• Abwesenheitsdaten (Urlaub, Krankheit, Anträge)
				</Text>
				<Text style={styles.listItem}>
					• Organisationsdaten (Team, Position, Standort)
				</Text>
				<Text style={styles.listItem}>
					• Qualifikationsdaten (sofern aktiviert)
				</Text>

				<Text
					style={styles.footer}
					fixed
					render={({ pageNumber, totalPages }) =>
						`Auftragsverarbeitungsvertrag – Seite ${pageNumber} von ${totalPages} – Erstellt am ${today}`
					}
				/>
			</Page>

			{/* Page 2 */}
			<Page size="A4" style={styles.page}>
				{/* --- Section 5 --- */}
				<Text style={styles.sectionTitle}>
					§ 5 Technische und organisatorische Maßnahmen (Art. 32 DSGVO)
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer hat folgende Maßnahmen zum Schutz personenbezogener
					Daten getroffen:
				</Text>
				<Text style={styles.listItem}>
					• Verschlüsselung der Datenübertragung (TLS 1.3)
				</Text>
				<Text style={styles.listItem}>
					• Verschlüsselung gespeicherter Daten (AES-256)
				</Text>
				<Text style={styles.listItem}>
					• Mehrstufige Zugriffskontrolle und rollenbasierte Berechtigungen
				</Text>
				<Text style={styles.listItem}>
					• Zwei-Faktor-Authentifizierung (TOTP, Passkeys)
				</Text>
				<Text style={styles.listItem}>
					• Regelmäßige Sicherheitsupdates und Patches
				</Text>
				<Text style={styles.listItem}>
					• Tägliche verschlüsselte Datensicherungen
				</Text>
				<Text style={styles.listItem}>
					• Protokollierung sicherheitsrelevanter Ereignisse (Audit-Log)
				</Text>
				<Text style={styles.listItem}>
					• Physische Zugangskontrollen im Rechenzentrum
				</Text>

				{/* --- Section 6 --- */}
				<Text style={styles.sectionTitle}>
					§ 6 Rechte und Pflichten des Auftraggebers
				</Text>
				<Text style={styles.paragraph}>
					Der Auftraggeber ist für die Einhaltung der datenschutzrechtlichen
					Bestimmungen verantwortlich, insbesondere für die Rechtmäßigkeit der
					Datenübermittlung an den Auftragnehmer sowie die Wahrung der Rechte
					der betroffenen Personen. Der Auftraggeber hat das Recht, die
					Einhaltung der Bestimmungen dieses Vertrages beim Auftragnehmer zu
					überprüfen.
				</Text>

				{/* --- Section 7 --- */}
				<Text style={styles.sectionTitle}>
					§ 7 Pflichten des Auftragnehmers
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer verarbeitet personenbezogene Daten ausschließlich
					auf dokumentierte Weisung des Auftraggebers und informiert diesen
					unverzüglich, falls eine Weisung gegen Datenschutzvorschriften
					verstößt. Alle zur Verarbeitung befugten Personen sind zur
					Vertraulichkeit verpflichtet.
				</Text>
				<Text style={styles.paragraph}>
					Der Auftragnehmer unterstützt den Auftraggeber bei der Erfüllung
					seiner Pflichten gemäß Art. 32§ DSGVO sowie bei der Beantwortung von
					Anträgen betroffener Personen gemäß Art. 12–22 DSGVO.
				</Text>

				{/* --- Section 8 --- */}
				<Text style={styles.sectionTitle}>
					§ 8 Einsatz von Unterauftragnehmern (Subprozessoren)
				</Text>
				<Text style={styles.paragraph}>
					Der Auftraggeber erteilt dem Auftragnehmer die allgemeine Genehmigung
					zur Beauftragung von Unterauftragnehmern gemäß Art. 28 Abs. 2 DSGVO.
					Der Auftragnehmer informiert den Auftraggeber über jede beabsichtigte
					Änderung in Bezug auf die Hinzuziehung oder Ersetzung von
					Unterauftragnehmern.
				</Text>
				<Text style={styles.paragraph}>
					Derzeit eingesetzte Unterauftragnehmer:
				</Text>
				{avvHostingDetails.subprocessors.map((subprocessor) => (
					<Text key={subprocessor.providerName} style={styles.listItem}>
						• {subprocessor.pdfText}
					</Text>
				))}
				<Text style={{ ...styles.paragraph, marginTop: 8 }}>
					Es werden keine weiteren Subprozessoren für die Verarbeitung
					personenbezogener Daten eingesetzt.
				</Text>

				{/* --- Section 9 --- */}
				<Text style={styles.sectionTitle}>
					§ 9 Löschung und Rückgabe personenbezogener Daten
				</Text>
				<Text style={styles.paragraph}>
					Nach Beendigung der vertraglichen Leistungen löscht der Auftragnehmer
					alle im Auftrag verarbeiteten personenbezogenen Daten einschließlich
					vorhandener Kopien, sofern keine gesetzliche Aufbewahrungspflicht
					besteht. Auf Wunsch des Auftraggebers wird vor der Löschung ein
					vollständiger Datenexport bereitgestellt.
				</Text>
				<Text style={styles.paragraph}>
					Die Löschung wird dem Auftraggeber schriftlich bestätigt.
				</Text>

				<Text
					style={styles.footer}
					fixed
					render={({ pageNumber, totalPages }) =>
						`Auftragsverarbeitungsvertrag – Seite ${pageNumber} von ${totalPages} – Erstellt am ${today}`
					}
				/>
			</Page>
		</Document>
	);

	const blob = await pdf(<AvvDocument />).toBlob();
	return new Uint8Array(await blob.arrayBuffer());
}

export function generateAvvFilename(organizationName: string): string {
	const sanitized = organizationName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
	const date = Temporal.Now.plainDateISO("UTC").toString();
	return `avv-${sanitized}-${date}.pdf`;
}
