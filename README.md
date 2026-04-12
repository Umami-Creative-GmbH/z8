Deutsch | [English](README.en.md)

# Z8 - Workforce Management für auditfähige Betriebsabläufe

Z8 ist eine Workforce-Management-Plattform für Organisationen, die zuverlässige Zeiterfassung, prüfungssichere Unterlagen und klare operative Kontrolle im Rahmen des deutschen Arbeitsrechts und der GoBD-Compliance (*Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern*) benötigen.

Über Web, Mobile und Desktop hinweg gibt Z8 Teams ein verlässliches operatives System für Zeiterfassung, Abwesenheiten, Reisekosten und das tägliche Workforce Management.

## Hinweis Zum Entwicklungsstand

Z8 befindet sich weiterhin in aktiver Entwicklung. Die Plattform wird bereits von mehreren Unternehmen unterschiedlicher Größe genutzt, aber einzelne Teile des Produkts können sich während der weiteren Reifung noch verändern.

Nicht alle Exportoptionen wurden bereits in jeder denkbaren Konstellation getestet. Wenn du auf einen Bug, einen Sonderfall beim Export oder anderes unerwartetes Verhalten stößt, erstelle bitte ein GitHub-Issue.

---

## 🛡️ GoBD- und Rechtskonformität

Z8 ist darauf ausgelegt, Organisationen in compliance-sensiblen Umgebungen ein sicheres und verlässliches Arbeiten zu ermöglichen.

- **Prüfungssichere Unterlagen**: Zeit-, Abwesenheits- und weitere Workforce-Daten werden in einer konsistenten Struktur erfasst, die verlässliche Auswertungen, Prüfungen und Aufsicht unterstützt.
- **Unveränderbares Ledger**: Zeitdaten behalten eine Append-only-, manipulationssichtbare Historie für klare Nachvollziehbarkeit und Audit-Readiness.
- **Nachvollziehbare Korrekturen & Genehmigungen**: Änderungen an erfassten Zeiten durchlaufen klare Freigabeprozesse mit sichtbarer Historie für Mitarbeitende, Führungskräfte und Compliance-Verantwortliche.
- **Digitale Integrität**: Automatisierte Hintergrundprüfungen verifizieren die Integrität der Datenkette und schützen vor Datenbankmanipulation.
- **Audit-Logs**: Umfassende Ereignisprotokolle für administrative Aktionen, von Berechtigungsänderungen bis hin zu Organisationseinstellungen.

## ⏱️ Erweiterte Zeiterfassung

- **Plattformübergreifender Zugriff**: Ein- und Ausstempeln über das vollwertige **Web-Dashboard**, die **Mobile App** (iOS/Android) oder das unaufdringliche **Tauri-Desktop-Widget**.
- **Korrektur-Workflows**: Schlanker Prozess für Mitarbeitende, um Zeitkorrekturen anzufragen, mit freigabebewusster Prüfung und schneller Rückmeldung durch Vorgesetzte.
- **Import-Hub für Stempelzeiten**: Historische oder externe Stempeldaten lassen sich über einen geführten Import statt manueller Nacherfassung in Z8 übernehmen.
- **Schnellaktionen**: Globales "Time Clock"-Popover im Web-Header für reibungsarmes Ein- und Ausstempeln auch während der Navigation in anderen Modulen.
- **Live-Status**: Echtzeit-Sichtbarkeit, wer im Team aktuell eingestempelt ist.

## 🏖️ Abwesenheits- und Feiertagsmanagement

- **Feiertags-Presets**: Automatischer Import landesspezifischer und regionaler Feiertage (Deutschland, inklusive Bundesländern).
- **Urlaubskonten**: Anspruchsvolle Berechnung verbleibender Urlaubstage auf Basis flexibler Zuweisungsregeln.
- **Flexible Kategorien**: Vorkonfigurierte Statusarten inklusive Home Office, Krankmeldung, Urlaub und benutzerdefinierter Abwesenheitstypen.
- **Genehmigungs-Engine**: Visuelle Zeitleiste für Führungskräfte, um Abwesenheitsanträge zu prüfen und freizugeben, während Teamabdeckungs-Konflikte sichtbar bleiben.
- **Reisekosten-Workflows**: Reisekostenanträge und Freigaben laufen im selben operativen Ablauf wie die restlichen Workforce-Prozesse.

## 📊 Einblicke & Reporting

- **Erweiterte Analysen**: Interaktive Dashboards für Teamleistung, Standorttrends und Workforce-Verteilung.
- **Exportbereit**: Erzeuge lohn- und auditfähige Exporte mit erweiterten Filtern für verlässliche Weiterverarbeitung.
- **Organisationsmanagement**: Verwalte Multi-Location-Organisationen, Teamstrukturen, Mitgliederverzeichnisse, Einladungsabläufe und Abteilungshierarchien zentral an einem Ort.

## 🔄 Integrationen & Datenaustausch

- **DATEV**: Exportiere lohnabrechnungsreife Zeitdaten für Buchhaltung und Payroll-Workflows.
- **Personio**: Exportiere Zeit- und Payroll-Daten für HR-Workflows.
- **SAP SuccessFactors**: Exportiere Zeit- und Payroll-Datensätze für Enterprise-HR-Workflows.
- **Workday**: Exportiere Payroll- und Workforce-Datensätze für Enterprise-HR-Prozesse.
- **Clockodo**: Importiere Zeitdaten in Z8 für einen reibungsloseren Wechsel.
- **Clockin**: Importiere Stempeldaten in Z8.

## 🔔 Moderne Produkterfahrung

- **Benachrichtigungen über mehrere Kanäle**: Bleibe über In-App-Hinweise, Desktop-Push-Benachrichtigungen (Web Push) und E-Mail-Templates informiert.
- **Dark-Mode-Unterstützung**: Voll responsives UI mit automatischem und manuellem Theme-Wechsel.
- **Echtzeit-Updates**: Notification Center auf Basis von Server-Sent Events (SSE) für unmittelbares Feedback bei Freigaben.

---

## 👍 Fair-Usage-Richtlinie

Z8 ist für Deployments mit bis zu 25 gleichzeitig aktiven Nutzern kostenlos. Organisationen oberhalb dieses Grenzwerts benötigen eine Enterprise-Lizenz, um nachhaltige Weiterentwicklung und fortlaufende Innovation zu unterstützen. Die Nutzung unterliegt außerdem weiteren Einschränkungen in der [License](LICENSE), einschließlich Beschränkungen für konkurrierende SaaS-Angebote und Billing-Funktionalität. Details dazu findest du in der [Fair Usage Policy](FairUsagePolicy.md):

- Voraussetzungen für die kostenlose Nutzung und die Zähllogik aktiver Nutzer
- Anonyme Telemetrie und Datenschutzgarantien
- Enterprise-Lizenzierungsoptionen
- Open-Source-Verpflichtung und Codezugang

---

## 📖 Dokumentation und Ressourcen

Für tiefergehende Informationen zu einzelnen Bereichen der Plattform siehe:

- **[User Guide](USER_GUIDE.md)**: Nutzung von Z8 aus Sicht von Mitarbeitenden oder Führungskräften.
- **[Admin Guide](ADMIN_GUIDE.md)**: Konfiguration, Compliance-Einstellungen und Organisationssetup.
- **[Development Guide](DEVELOPMENT.md)**: Technische Architektur, Setup-Hinweise und Richtlinien für Beiträge.
- **[Fair Usage Policy](FairUsagePolicy.md)**: Lizenzbedingungen für Deployments mit mehr als 25 Nutzern.
- **[License](LICENSE)**: Details zur Open-Source-Lizenz.

---

*Mit Präzision für die moderne Arbeitswelt entwickelt.*

