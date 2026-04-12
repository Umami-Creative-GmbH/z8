# README Language Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `README.md` the primary German README, preserve the current English content in `README.en.md`, and add language-switch links between both files.

**Architecture:** Keep this as a minimal top-level documentation split. The current English README content is copied into `README.en.md`, then `README.md` is rewritten as a German counterpart with the same structure, links, and overall claims. Both files expose a visible top-of-file language switcher.

**Tech Stack:** Markdown, Git, ripgrep

---

## File Structure

- Create: `README.en.md`
  Purpose: preserve the current English README as the fallback version.
- Modify: `README.md`
  Purpose: become the primary German README while keeping the same overall structure and links.

### Task 1: Snapshot The English README Into `README.en.md`

**Files:**
- Create: `README.en.md`
- Modify: `README.md`

- [ ] **Step 1: Verify the English fallback file does not already exist**

Run: `rg -n "^# Z8|^Deutsch \| \[English\]" README.en.md`
Expected: no matches because `README.en.md` does not exist yet.

- [ ] **Step 2: Create `README.en.md` from the current English README content with a language switcher**

```md
[Deutsch](README.md) | English

# Z8 - Workforce Management for Audit-Ready Operations

Z8 is a workforce management platform built for organizations that need reliable time tracking, audit-ready records, and clear operational control under German labor law and GoBD compliance (*Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern*).

Across Web, Mobile, and Desktop, Z8 gives teams a dependable operational system for time tracking, absences, travel expenses, and day-to-day workforce management.

## WIP Notice

Z8 is still a work in progress. It is already used by several companies of different sizes, but some parts of the product may still change as the platform continues to mature.

Not all export options have been tested in all circumstances yet. If you run into a bug, an export edge case, or other unexpected behavior, please open a GitHub issue.

---

## 🛡️ GoBD & Legal Compliance

Z8 is designed to help organizations operate with confidence in compliance-sensitive environments.

- **Audit-Ready Records**: Time, absence, and related workforce records are captured in a consistent structure that supports dependable reporting, review, and oversight.
- **Immutable Ledger**: Time records keep an append-only, tamper-evident history for clear traceability and audit readiness.
- **Traceable Corrections & Approvals**: Changes to recorded time move through clear approval flows with visible history for employees, managers, and compliance stakeholders.
- **Digital Integrity**: Automated background checks verify the integrity of the data chain to protect against database manipulation.
- **Audit Logs**: Comprehensive event logging for all administrative actions, from user permission changes to organization settings.

## ⏱️ Advanced Time Tracking

- **Multi-Platform Access**: Clock in via the full-featured **Web Dashboard**, the **Mobile App** (iOS/Android), or the low-profile **Tauri Desktop widget**.
- **Correction Workflows**: Streamlined process for employees to request time corrections, with approval-aware reviews and fast manager follow-up.
- **Clock-In Import Hub**: Bring historical or external clock-in data into Z8 with a guided import flow instead of manual re-entry.
- **Quick Actions**: Global "Time Clock" popover in the web header for friction-less clock-in/out even when navigating other modules.
- **Live Status**: Real-time visibility into who is currently clocked in within your team.

## 🏖️ Absence & Holiday Management

- **Holiday Presets**: Automated import of country-specific and regional public holidays (Deutschland, Bundesländer support).
- **Vacation Balance Tracking**: Sophisticated calculation of remaining leave days based on flexible assignment policies.
- **Flexible Categories**: Pre-configured status types including Home Office, Sick Leave, Vacation, and custom absence types.
- **Approval Engine**: Visual timeline for managers to review and approve absence requests while checking for team coverage conflicts.
- **Travel Expense Workflows**: Handle travel expense claims and approvals in the same operational workflow as the rest of your workforce processes.

## 📊 Insights & Reporting

- **Advanced Analytics**: Interactive dashboards for team performance, location trends, and workforce distribution.
- **Export Ready**: Generate payroll and audit-ready exports with advanced filtering for dependable downstream processing.
- **Organization Management**: Manage multi-location organizations, team structures, member directories, invitation flows, and department hierarchies from one place.

## 🔄 Integrations & Data Exchange

- **DATEV**: Export payroll-ready time data for accounting and payroll workflows.
- **Personio**: Export time and payroll data for HR workflows.
- **SAP SuccessFactors**: Export time and payroll records for enterprise HR workflows.
- **Workday**: Export payroll and workforce records for enterprise HR operations.
- **Clockodo**: Import time records into Z8 for a smoother transition.
- **Clockin**: Import clock-in records into Z8.

## 🔔 Modern Experience

- **Multi-Channel Notifications**: Stay informed via In-app alerts, Desktop Push notifications (Web Push), and Email templates.
- **Dark Mode Support**: Fully responsive UI with automated and manual theme toggling.
- **Real-Time Updates**: Notification center powered by Server-Sent Events (SSE) for instant feedback on approvals.

---

## 👍 Fair Usage Policy

Z8 is free for deployments with up to 25 concurrent active users. Organizations exceeding this threshold require an enterprise license to support sustainable development and continued innovation. Use is also subject to additional restrictions in the [License](LICENSE), including restrictions on competing SaaS offerings and billing functionality. Read the [Fair Usage Policy](FairUsagePolicy.md) for details on:

- Free tier eligibility and active user counting
- Anonymous telemetry and privacy guarantees
- Enterprise licensing options
- Open-source commitment and code access

---

## 📖 Documentation & Resources

For deeper dives into specific areas of the platform, please refer to:

- **[User Guide](USER_GUIDE.md)**: How to use Z8 as an employee or manager.
- **[Admin Guide](ADMIN_GUIDE.md)**: Configuration, compliance settings, and organization setup.
- **[Development Guide](DEVELOPMENT.md)**: Technical architecture, setup instructions, and contribution guidelines.
- **[Fair Usage Policy](FairUsagePolicy.md)**: Licensing terms for deployments exceeding 25 users.
- **[License](LICENSE)**: Open source license details.

---

*Built with precision for the modern workforce.*
```

- [ ] **Step 3: Verify the new English fallback file contains the switcher and title**

Run: `rg -n "^\[Deutsch\]\(README.md\) \| English$|^# Z8 - Workforce Management for Audit-Ready Operations$" README.en.md`
Expected: one match for the language switcher and one match for the main English title.

### Task 2: Rewrite `README.md` As The Primary German README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Verify `README.md` is still the English source before rewriting it**

Run: `rg -n "^# Z8 - Workforce Management for Audit-Ready Operations$|^## WIP Notice$|^## 📖 Documentation & Resources$" README.md`
Expected: matches for the current English title and section headings.

- [ ] **Step 2: Replace `README.md` with the German primary README and add the mirrored switcher**

```md
Deutsch | [English](README.en.md)

# Z8 - Workforce Management fuer auditfaehige Betriebsablaeufe

Z8 ist eine Workforce-Management-Plattform fuer Organisationen, die zuverlaessige Zeiterfassung, pruefungssichere Unterlagen und klare operative Kontrolle im Rahmen des deutschen Arbeitsrechts und der GoBD-Compliance (*Grundsaetze zur ordnungsmaessigen Fuehrung und Aufbewahrung von Buechern*) benoetigen.

Ueber Web, Mobile und Desktop hinweg gibt Z8 Teams ein verlaessliches operatives System fuer Zeiterfassung, Abwesenheiten, Reisekosten und das taegliche Workforce Management.

## Hinweis Zum Entwicklungsstand

Z8 befindet sich weiterhin in aktiver Entwicklung. Die Plattform wird bereits von mehreren Unternehmen unterschiedlicher Groesse genutzt, aber einzelne Teile des Produkts koennen sich waehrend der weiteren Reifung noch veraendern.

Nicht alle Exportoptionen wurden bereits in jeder denkbaren Konstellation getestet. Wenn du auf einen Bug, einen Sonderfall beim Export oder anderes unerwartetes Verhalten stoesst, erstelle bitte ein GitHub-Issue.

---

## 🛡️ GoBD- und Rechtskonformitaet

Z8 ist darauf ausgelegt, Organisationen in compliance-sensiblen Umgebungen ein sicheres und verlaessliches Arbeiten zu ermoeglichen.

- **Pruefungssichere Unterlagen**: Zeit-, Abwesenheits- und weitere Workforce-Daten werden in einer konsistenten Struktur erfasst, die verlaessliche Auswertungen, Pruefungen und Aufsicht unterstuetzt.
- **Unveraenderbares Ledger**: Zeitdaten behalten eine append-only, manipulationssichtbare Historie fuer klare Nachvollziehbarkeit und Audit-Readiness.
- **Nachvollziehbare Korrekturen und Genehmigungen**: Aenderungen an erfassten Zeiten durchlaufen klare Freigabeprozesse mit sichtbarer Historie fuer Mitarbeitende, Fuehrungskraefte und Compliance-Verantwortliche.
- **Digitale Integritaet**: Automatisierte Hintergrundpruefungen verifizieren die Integritaet der Datenkette und schuetzen vor Datenbankmanipulation.
- **Audit-Logs**: Umfassende Ereignisprotokolle fuer administrative Aktionen, von Berechtigungsaenderungen bis hin zu Organisationseinstellungen.

## ⏱️ Erweiterte Zeiterfassung

- **Plattformuebergreifender Zugriff**: Ein- und Ausstempeln ueber das vollwertige **Web-Dashboard**, die **Mobile App** (iOS/Android) oder das unaufdringliche **Tauri-Desktop-Widget**.
- **Korrektur-Workflows**: Schlanker Prozess fuer Mitarbeitende, um Zeitkorrekturen anzufragen, mit freigabebewusster Pruefung und schneller Rueckmeldung durch Vorgesetzte.
- **Import-Hub fuer Stempelzeiten**: Historische oder externe Stempeldaten lassen sich ueber einen gefuehrten Import statt manueller Nacherfassung in Z8 uebernehmen.
- **Schnellaktionen**: Globales "Time Clock"-Popover im Web-Header fuer reibungsarmes Ein- und Ausstempeln auch waehrend der Navigation in anderen Modulen.
- **Live-Status**: Echtzeit-Sichtbarkeit, wer im Team aktuell eingestempelt ist.

## 🏖️ Abwesenheits- und Feiertagsmanagement

- **Feiertags-Presets**: Automatischer Import landesspezifischer und regionaler Feiertage (Deutschland, inklusive Bundeslaendern).
- **Urlaubskonten**: Anspruchsvolle Berechnung verbleibender Urlaubstage auf Basis flexibler Zuweisungsregeln.
- **Flexible Kategorien**: Vorkonfigurierte Statusarten wie Home Office, Krankmeldung, Urlaub und benutzerdefinierte Abwesenheitstypen.
- **Genehmigungs-Engine**: Visuelle Zeitleiste fuer Fuehrungskraefte, um Abwesenheitsantraege zu pruefen und freizugeben, waehrend Teamabdeckungs-Konflikte sichtbar bleiben.
- **Reisekosten-Workflows**: Reisekostenantraege und Freigaben laufen im selben operativen Ablauf wie die restlichen Workforce-Prozesse.

## 📊 Einblicke und Reporting

- **Erweiterte Analysen**: Interaktive Dashboards fuer Teamleistung, Standorttrends und Workforce-Verteilung.
- **Exportbereit**: Erzeuge lohn- und auditfaehige Exporte mit erweiterten Filtern fuer verlaessliche Weiterverarbeitung.
- **Organisationsmanagement**: Verwalte Multi-Location-Organisationen, Teamstrukturen, Mitgliederverzeichnisse, Einladungsablaeufe und Abteilungshierarchien zentral an einem Ort.

## 🔄 Integrationen und Datenaustausch

- **DATEV**: Exportiere lohnabrechnungsreife Zeitdaten fuer Buchhaltung und Payroll-Workflows.
- **Personio**: Exportiere Zeit- und Payroll-Daten fuer HR-Workflows.
- **SAP SuccessFactors**: Exportiere Zeit- und Payroll-Datensaetze fuer Enterprise-HR-Workflows.
- **Workday**: Exportiere Payroll- und Workforce-Datensaetze fuer Enterprise-HR-Prozesse.
- **Clockodo**: Importiere Zeitdaten in Z8 fuer einen reibungsloseren Wechsel.
- **Clockin**: Importiere Stempeldaten in Z8.

## 🔔 Moderne Produkterfahrung

- **Benachrichtigungen ueber mehrere Kanaele**: Bleibe ueber In-App-Hinweise, Desktop-Push-Benachrichtigungen (Web Push) und E-Mail-Templates informiert.
- **Dark-Mode-Unterstuetzung**: Voll responsives UI mit automatischem und manuellem Theme-Wechsel.
- **Echtzeit-Updates**: Notification Center auf Basis von Server-Sent Events (SSE) fuer unmittelbares Feedback bei Freigaben.

---

## 👍 Fair-Usage-Richtlinie

Z8 ist fuer Deployments mit bis zu 25 gleichzeitig aktiven Nutzern kostenlos. Organisationen oberhalb dieses Grenzwerts benoetigen eine Enterprise-Lizenz, um nachhaltige Weiterentwicklung und fortlaufende Innovation zu unterstuetzen. Die Nutzung unterliegt ausserdem weiteren Einschraenkungen in der [License](LICENSE), einschliesslich Beschraenkungen fuer konkurrierende SaaS-Angebote und Billing-Funktionalitaet. Details dazu findest du in der [Fair Usage Policy](FairUsagePolicy.md):

- Voraussetzungen fuer die kostenlose Nutzung und die Zaehllogik aktiver Nutzer
- Anonyme Telemetrie und Datenschutzgarantien
- Enterprise-Lizenzierungsoptionen
- Open-Source-Verpflichtung und Codezugang

---

## 📖 Dokumentation und Ressourcen

Fuer tiefergehende Informationen zu einzelnen Bereichen der Plattform siehe:

- **[User Guide](USER_GUIDE.md)**: Nutzung von Z8 aus Sicht von Mitarbeitenden oder Fuehrungskraeften.
- **[Admin Guide](ADMIN_GUIDE.md)**: Konfiguration, Compliance-Einstellungen und Organisationssetup.
- **[Development Guide](DEVELOPMENT.md)**: Technische Architektur, Setup-Hinweise und Richtlinien fuer Beitraege.
- **[Fair Usage Policy](FairUsagePolicy.md)**: Lizenzbedingungen fuer Deployments mit mehr als 25 Nutzern.
- **[License](LICENSE)**: Details zur Open-Source-Lizenz.

---

*Mit Praezision fuer die moderne Arbeitswelt entwickelt.*
```

- [ ] **Step 3: Verify `README.md` now contains the German switcher and German section headings**

Run: `rg -n "^Deutsch \| \[English\]\(README.en.md\)$|^## Hinweis Zum Entwicklungsstand$|^## 📖 Dokumentation und Ressourcen$" README.md`
Expected: one match for the top language switcher and matches for the German section headings.

### Task 3: Validate The Bilingual README Pair

**Files:**
- Modify: `README.md`
- Create: `README.en.md`

- [ ] **Step 1: Verify both files cross-link correctly**

Run: `rg -n "README\.en\.md|README\.md" README.md README.en.md`
Expected: `README.md` links to `README.en.md` and `README.en.md` links back to `README.md`.

- [ ] **Step 2: Review the final diff for just the intended documentation split**

Run: `git diff -- README.md README.en.md`
Expected: `README.md` is rewritten in German, `README.en.md` is added in English, and both files contain the mirrored language switchers.

- [ ] **Step 3: Commit the documentation change**

```bash
git add README.md README.en.md docs/superpowers/specs/2026-04-12-readme-language-split-design.md docs/superpowers/plans/2026-04-12-readme-language-split.md
git commit -m "docs: split README into German and English"
```
