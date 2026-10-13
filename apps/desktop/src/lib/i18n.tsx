import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { Language } from "./language";

const german: Record<string, string> = {
	"Work changed on another device. Resolve the earlier saved action before clocking again.":
		"Die Arbeit wurde auf einem anderen Gerät geändert. Klären Sie die zuvor gespeicherte Aktion, bevor Sie erneut stempeln.",
	"Your device timezone has changed":
		"Die Zeitzone Ihres Geräts hat sich geändert",
	"Device timezone": "Gerätezeitzone",
	"Saved timezone": "Gespeicherte Zeitzone",
	"This action uses the device timezone. Your day total uses your saved timezone.":
		"Diese Aktion verwendet die Gerätezeitzone. Ihre Tagessumme verwendet Ihre gespeicherte Zeitzone.",
	"Update saved timezone in Z8": "Gespeicherte Zeitzone in Z8 aktualisieren",
	"Continue once": "Einmal fortfahren",
	"Day summary could not be loaded":
		"Die Tagessumme konnte nicht geladen werden",
	"Preferences could not be loaded":
		"Einstellungen konnten nicht geladen werden",
	"Malformed records": "Unlesbare Datensätze",
	"Retry limit reached": "Wiederholungsgrenze erreicht",
	"Possible partial breaks": "Möglicherweise unvollständige Pausen",
	"Break closes acknowledged": "Bestätigte Pausenbeginne",
	"App updates": "App-Updates",
	"Review update": "Update ansehen",
	"Installing…": "Wird installiert…",
	"Update installation failed": "Update-Installation fehlgeschlagen",
	"Refresh status before confirming a break.":
		"Aktualisieren Sie den Status, bevor Sie eine Pause bestätigen.",
	"Time tracking": "Zeiterfassung",
	"Clock in": "Einstempeln",
	"Clock out": "Ausstempeln",
	"Start break": "Pause beginnen",
	"Resume work": "Arbeit fortsetzen",
	"End day": "Arbeitstag beenden",
	"On break": "In Pause",
	"Currently working": "Arbeitet gerade",
	"Not clocked in": "Nicht eingestempelt",
	"Time elapsed": "Laufende Arbeitszeit",
	"Ready to work": "Bereit zur Arbeit",
	"Clock actions paused": "Stempelaktionen pausiert",
	"Check status and saved actions": "Status und gespeicherte Aktionen prüfen",
	"Processing…": "Wird verarbeitet…",
	Today: "Heute",
	"Estimated today": "Heute geschätzt",
	"Server total": "Serverstand",
	"Day total unavailable": "Tagessumme nicht verfügbar",
	"Saved on this device": "Auf diesem Gerät gespeichert",
	"Confirmed by server": "Vom Server bestätigt",
	"Includes pending actions": "Enthält noch unbestätigte Aktionen",
	"Last server update": "Letzter Serverstand",
	Organization: "Organisation",
	"Select organization": "Organisation auswählen",
	"Switch organization": "Organisation wechseln",
	"Organization could not be loaded":
		"Organisation konnte nicht geladen werden",
	"No employee access": "Kein Mitarbeiterzugriff",
	"SSO sign-in required": "SSO-Anmeldung erforderlich",
	"Work location": "Arbeitsort",
	"Office / On-site": "Büro / Vor Ort",
	Home: "Zuhause",
	Remote: "Unterwegs",
	Other: "Sonstiges",
	Project: "Projekt",
	"Work category": "Arbeitskategorie",
	"Keep current assignment": "Aktuelle Zuordnung beibehalten",
	"No assignment": "Keine Zuordnung",
	Task: "Aufgabe",
	"Keep current task:": "Aktuelle Aufgabe beibehalten:",
	"No task": "Keine Aufgabe",
	"The chosen task was marked done.":
		"Die gewählte Aufgabe wurde als erledigt markiert.",
	"The chosen task belongs to another project.":
		"Die gewählte Aufgabe gehört zu einem anderen Projekt.",
	"The chosen task no longer exists.":
		"Die gewählte Aufgabe existiert nicht mehr.",
	"The chosen task is not available.":
		"Die gewählte Aufgabe ist nicht verfügbar.",
	"The chosen project is not open for booking.":
		"Das gewählte Projekt ist nicht für Buchungen geöffnet.",
	"Time cannot be booked to the chosen project.":
		"Auf das gewählte Projekt kann keine Zeit gebucht werden.",
	"The chosen work category is not available.":
		"Die gewählte Arbeitskategorie ist nicht verfügbar.",
	"Applied when work ends": "Wird beim Arbeitsende zugeordnet",
	Settings: "Einstellungen",
	"Open dashboard": "Dashboard öffnen",
	"Open settings": "Einstellungen öffnen",
	"Close settings": "Einstellungen schließen",
	Server: "Server",
	"Always on top": "Immer im Vordergrund",
	"Launch at Windows sign-in": "Bei Windows-Anmeldung starten",
	"Idle reminders": "Erinnerung bei Inaktivität",
	"Minutes before reminder": "Minuten bis zur Erinnerung",
	"Inactivity is not recorded until you confirm a break.":
		"Inaktivität wird erst nach Ihrer Bestätigung als Pause erfasst.",
	Language: "Sprache",
	"Z8 preference": "Z8-Einstellung",
	English: "Englisch",
	German: "Deutsch",
	Save: "Speichern",
	Cancel: "Abbrechen",
	"Sign out": "Abmelden",
	"Preferences could not be saved":
		"Einstellungen konnten nicht gespeichert werden",
	"Your time tracking companion": "Ihr Begleiter für die Zeiterfassung",
	"Sign in with Z8": "Mit Z8 anmelden",
	"Opening browser…": "Browser wird geöffnet…",
	"Complete sign-in in your browser, then return here.":
		"Melden Sie sich im Browser an und kehren Sie dann hierher zurück.",
	"Sign-in failed": "Anmeldung fehlgeschlagen",
	"Configure your Z8 server in settings.":
		"Tragen Sie Ihren Z8-Server in den Einstellungen ein.",
	"Change theme": "Design ändern",
	"Current theme": "Aktuelles Design",
	System: "System",
	Light: "Hell",
	Dark: "Dunkel",
	"Clock status unavailable": "Stempelstatus nicht verfügbar",
	Offline: "Offline",
	"Reconnect to switch organizations":
		"Zum Organisationswechsel wieder verbinden",
	"Online mode": "Online-Modus",
	"Z8 update required": "Z8-Update erforderlich",
	"The Z8 webapp needs an update for online desktop clocking. Use the dashboard icon above until it is deployed; no setup is needed on your computer.":
		"Die Z8-Webapp benötigt ein Update zum Stempeln in der Desktop-App. Nutzen Sie bis dahin das Dashboard-Symbol oben. Auf Ihrem Computer müssen Sie nichts einrichten.",
	"Connection required": "Verbindung erforderlich",
	"Internet required. Offline recording and automatic idle breaks are not available yet.":
		"Internet erforderlich. Offline-Stempeln und automatische Pausen sind noch nicht verfügbar.",
	"Connect to Z8 and refresh status to use the clock. You can also open your dashboard using the icon above.":
		"Verbinden Sie sich mit Z8 und aktualisieren Sie den Status. Über das Symbol oben können Sie auch Ihr Dashboard öffnen.",
	"Refresh status": "Status aktualisieren",
	"Clock recovery": "Wiederherstellung",
	"Saved actions": "Gespeicherte Aktionen",
	"Recently resolved": "Kürzlich geklärt",
	"Needs review": "Prüfung erforderlich",
	Retry: "Erneut versuchen",
	Archive: "Archivieren",
	"Copy details": "Details kopieren",
	"Details copied": "Details kopiert",
	"Details could not be copied": "Details konnten nicht kopiert werden",
	"Saved action paused": "Gespeicherte Aktion pausiert",
	"Waiting for sign-in": "Wartet auf Anmeldung",
	"Waiting for organization access": "Wartet auf Organisationszugriff",
	"Waiting for subscription": "Wartet auf Abonnement",
	"Waiting for original context": "Wartet auf ursprünglichen Kontext",
	"Waiting for server setup": "Wartet auf Servereinrichtung",
	"App update required": "App-Update erforderlich",
	"Waiting for server": "Wartet auf Server",
	"Sent after earlier actions": "Wird nach früheren Aktionen gesendet",
	"Retry checks the original action before sending it again.":
		"Vor dem erneuten Senden wird die ursprüngliche Aktion geprüft.",
	"The server refused this action. Review it in Z8; the evidence stays here.":
		"Der Server hat diese Aktion abgelehnt. Prüfen Sie sie in Z8; der Nachweis bleibt hier.",
	"Archived evidence stays on this device.":
		"Archivierte Nachweise bleiben auf diesem Gerät.",
	"Actions in another context": "Aktionen in einem anderen Kontext",
	"Switch back to their original account, organization and server to synchronize.":
		"Wechseln Sie zur ursprünglichen Anmeldung, Organisation und zum Server zurück, um zu synchronisieren.",
	"Legacy records require authorized recovery before clocking.":
		"Alte Datensätze müssen vor dem Stempeln autorisiert wiederhergestellt werden.",
	"Ownership is unverified. Original records are retained; no automatic replay or deletion.":
		"Die Zuordnung ist ungeklärt. Originaldaten bleiben erhalten; kein automatisches Wiederholen oder Löschen.",
	"Local clock storage is unavailable. Clock actions are paused.":
		"Der lokale Stempelspeicher ist nicht verfügbar. Stempelaktionen sind pausiert.",
	"Refresh current status before another action.":
		"Aktualisieren Sie den Status vor einer weiteren Aktion.",
	"You were away": "Sie waren inaktiv",
	"Was this a break?": "War dies eine Pause?",
	"I was on break": "Ich war in Pause",
	"I was still working": "Ich habe weitergearbeitet",
	Continue: "Weiter",
	"This interval needs a reviewed correction in Z8. Nothing is recorded automatically.":
		"Dieses Intervall benötigt eine geprüfte Korrektur in Z8. Es wird nichts automatisch erfasst.",
	"Work resumes at the detected return, not when you answer.":
		"Die Arbeit beginnt bei Ihrer erkannten Rückkehr, nicht bei Ihrer Antwort.",
	"Time entries and corrections": "Zeiten und Korrekturen",
	Reports: "Berichte",
	"Could not open Z8": "Z8 konnte nicht geöffnet werden",
	"Clock action failed": "Stempelaktion fehlgeschlagen",
	"Break recorded": "Pause erfasst",
	"Day ended": "Arbeitstag beendet",
	"Saved work needs review": "Gespeicherte Arbeit muss geprüft werden",
	"Previous context updated": "Vorheriger Kontext aktualisiert",
	"Check your time entries in Z8 before recording replacement work.":
		"Prüfen Sie Ihre Zeiten in Z8, bevor Sie Ersatzzeiten erfassen.",
	"Check for updates": "Nach Updates suchen",
	"Checking…": "Wird geprüft…",
	"Up to date": "Aktuell",
	"Update available": "Update verfügbar",
	"Install and restart": "Installieren und neu starten",
	"Update check failed": "Update-Prüfung fehlgeschlagen",
	"Saved actions remain on this device during the restart.":
		"Gespeicherte Aktionen bleiben während des Neustarts auf diesem Gerät.",
	"Release updates are not configured yet.":
		"Release-Updates sind noch nicht eingerichtet.",
	"Vehicle use": "Fahrzeugnutzung",
	Vehicle: "Fahrzeug",
	"No vehicle": "Kein Fahrzeug",
	"Own vehicle": "Eigenes Fahrzeug",
	"Organization vehicle": "Firmenfahrzeug",
	"Start reading (km)": "Anfangskilometerstand (km)",
	"End reading (km)": "Endkilometerstand (km)",
	"Driven distance (km)": "Gefahrene Strecke (km)",
	"Odometer reading at the break (km)": "Kilometerstand bei der Pause (km)",
	"Optional. It ends this work's reading and starts the next one's.":
		"Optional. Er beendet den Kilometerstand dieser Arbeit und beginnt den der nächsten.",
	"from {km} km": "ab {km} km",
	"Your organization expects you to record the vehicle you drove and its readings.":
		"Ihre Organisation erwartet, dass Sie das gefahrene Fahrzeug und seine Kilometerstände erfassen.",
	"Please check the vehicle use": "Bitte prüfen Sie die Fahrzeugnutzung",
	"The start reading is below this vehicle's last recorded end reading ({km} km).":
		"Der Anfangskilometerstand liegt unter dem zuletzt erfassten Endkilometerstand dieses Fahrzeugs ({km} km).",
	"This vehicle is already recorded on another employee's running work.":
		"Dieses Fahrzeug ist bereits in der laufenden Arbeit einer anderen Person erfasst.",
	"The driven distance implies an average of {speed} km/h over this work period, more than 150 km/h.":
		"Die gefahrene Strecke ergibt in diesem Arbeitszeitraum durchschnittlich {speed} km/h, mehr als 150 km/h.",
	"{km} km is more than 1,500 km in one work period.":
		"{km} km sind mehr als 1.500 km in einem Arbeitszeitraum.",
	"The end reading cannot be below the start reading.":
		"Der Endkilometerstand darf nicht unter dem Anfangskilometerstand liegen.",
	"Enter odometer readings in whole kilometres.":
		"Geben Sie Kilometerstände in ganzen Kilometern ein.",
	"Enter the driven distance in whole kilometres.":
		"Geben Sie die gefahrene Strecke in ganzen Kilometern ein.",
	"Choose an organization vehicle or your own vehicle.":
		"Wählen Sie ein Firmenfahrzeug oder Ihr eigenes Fahrzeug.",
	"Vehicle use was not recorded": "Die Fahrzeugnutzung wurde nicht erfasst",
	"This server does not record the break's odometer reading. Add it to the work in Z8.":
		"Dieser Server erfasst den Kilometerstand der Pause nicht. Tragen Sie ihn in Z8 bei der Arbeit nach.",
};
const LocaleContext = createContext<Language>("en");
export function LocaleProvider({
	language,
	children,
}: {
	language: Language;
	children: ReactNode;
}) {
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	return (
		<LocaleContext.Provider value={language}>{children}</LocaleContext.Provider>
	);
}
export function useI18n() {
	const language = useContext(LocaleContext);
	return {
		language,
		t: (message: string) =>
			language === "de" ? (german[message] ?? message) : message,
	};
}
