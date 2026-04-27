import type { Metadata } from "next";
import { cloneElement, isValidElement, type ReactNode } from "react";
import type { Locale } from "./locales";
import { alternatePath, getLocalizedPath } from "./locales";

export type VariantId =
	| "s-1"
	| "s-2"
	| "s-3"
	| "s-4"
	| "s-5"
	| "s-6"
	| "s-7"
	| "s-8"
	| "s-9"
	| "s-10";

const siteUrl = "https://z8-time.app";

const variantMetadataCopy: Record<
	VariantId,
	Record<Locale, { title: string; description: string }>
> = {
	"s-1": {
		de: {
			title: "Z8 | Die Kunst der Zeiterfassung",
			description:
				"Eine ruhige, klare Z8-Variante für Zeiterfassung, Schichtplanung, Berichte und Lohnexport.",
		},
		en: {
			title: "Z8 | The Art of Time Tracking",
			description:
				"A calm, precise Z8 variant for time tracking, scheduling, reports, and payroll export.",
		},
	},
	"s-2": {
		de: {
			title: "Z8 | Natürliche Zeiterfassung",
			description:
				"Eine weiche, organische Z8-Variante für einfache und verlässliche Zeiterfassung.",
		},
		en: {
			title: "Z8 | Natural Time Tracking",
			description: "A soft, organic Z8 variant for simple and dependable time tracking.",
		},
	},
	"s-3": {
		de: {
			title: "Z8 | Zeit ist Code",
			description:
				"Eine technische Z8-Variante mit Systemmodulen für präzise Arbeitszeiterfassung.",
		},
		en: {
			title: "Z8 | Time Is Code",
			description:
				"A technical Z8 variant with system modules for precise workforce time tracking.",
		},
	},
	"s-4": {
		de: {
			title: "Z8 | Handwerk trifft Technologie",
			description:
				"Eine warme, handwerkliche Z8-Variante für strukturierte Zeiterfassung im Alltag.",
		},
		en: {
			title: "Z8 | Craft Meets Technology",
			description: "A warm, crafted Z8 variant for structured everyday time tracking.",
		},
	},
	"s-5": {
		de: {
			title: "Z8 | Kristallklare Zeiterfassung",
			description: "Eine klare Glassmorphism-Z8-Variante für transparente Arbeitszeitdaten.",
		},
		en: {
			title: "Z8 | Crystal-Clear Time Tracking",
			description: "A clear glassmorphism Z8 variant for transparent workforce time data.",
		},
	},
	"s-6": {
		de: {
			title: "Z8 | Zeiterfassung wie auf dem Whiteboard",
			description:
				"Eine skizzenhafte Z8-Variante für einfache digitale Zeiterfassung ohne Schnickschnack.",
		},
		en: {
			title: "Z8 | Whiteboard-Style Time Tracking",
			description: "A sketch-like Z8 variant for simple digital time tracking without clutter.",
		},
	},
	"s-7": {
		de: {
			title: "Z8 | Beständig wie Kupfer",
			description: "Eine dunkle Kupfer-Z8-Variante für langlebige und skalierbare Zeiterfassung.",
		},
		en: {
			title: "Z8 | Durable as Copper",
			description: "A dark copper Z8 variant for durable, scalable time tracking.",
		},
	},
	"s-8": {
		de: {
			title: "Z8 Anzeiger | Moderne Zeiterfassung",
			description:
				"Eine Zeitungsvariante für Z8 mit digitaler Zeiterfassung, Berichten und Team-Verwaltung.",
		},
		en: {
			title: "Z8 Gazette | Modern Time Tracking",
			description:
				"A newspaper-style Z8 variant for digital time tracking, reports, and team management.",
		},
	},
	"s-9": {
		de: {
			title: "Z8 | Jeder Morgen zählt",
			description: "Eine warme Sonnenaufgangs-Z8-Variante für klare tägliche Zeiterfassung.",
		},
		en: {
			title: "Z8 | Every Morning Counts",
			description: "A warm sunrise Z8 variant for clear daily time tracking.",
		},
	},
	"s-10": {
		de: {
			title: "Z8 | Präzision in jeder Sekunde",
			description:
				"Eine präzise Slate-Blue-Z8-Variante für genaue Arbeitszeiterfassung und Berichte.",
		},
		en: {
			title: "Z8 | Precision in Every Second",
			description: "A precise slate-blue Z8 variant for accurate time tracking and reporting.",
		},
	},
};

export function variantMetadata(locale: Locale, variantId: VariantId): Metadata {
	const pathname = `/${variantId}`;
	const path = getLocalizedPath(pathname, locale);
	const alternates = alternatePath(pathname);
	const copy = variantMetadataCopy[variantId][locale];

	return {
		...copy,
		alternates: {
			canonical: `${siteUrl}${path}`,
			languages: {
				de: `${siteUrl}${alternates.de}`,
				en: `${siteUrl}${alternates.en}`,
				"x-default": `${siteUrl}${alternates["x-default"]}`,
			},
		},
		openGraph: {
			...copy,
			url: `${siteUrl}${path}`,
			siteName: "Z8",
			type: "website",
			locale: locale === "de" ? "de_DE" : "en_US",
		},
	};
}

const commonVisibleCopy: Record<string, string> = {
	Zeiterfassung: "Time Tracking",
	Funktionen: "Features",
	Workflow: "Workflow",
	Compliance: "Compliance",
	Integrationen: "Integrations",
	Kontakt: "Contact",
	Preise: "Pricing",
	Starten: "Start",
	"Kostenlos testen": "Try for free",
	"Kostenlos starten": "Start for free",
	"Jetzt starten": "Start now",
	"Jetzt kostenlos starten": "Start free now",
	"Mehr erfahren": "Learn more",
	Entdecken: "Explore",
	Erkunden: "Explore",
	"← Alle Designs": "← All designs",
	Stempeluhr: "Time Clock",
	Berichte: "Reports",
	Schichtplanung: "Shift Planning",
	Lohnexport: "Payroll Export",
	Urlaubsverwaltung: "Absence Management",
	Überstundenkonto: "Overtime Account",
	Zeit: "Time",
	Übersicht: "Overview",
	Nutzer: "Users",
	Registrieren: "Register",
	Erfassen: "Track",
	Auswerten: "Analyze",
	"Schritt ": "Step ",
	Unternehmen: "Company",
	Produkt: "Product",
	Rechtliches: "Legal",
	Datenschutz: "Privacy",
	Impressum: "Legal Notice",
	"Über uns": "About us",
	Karriere: "Careers",
	Presse: "Press",
	"Made in Frankfurt am Main": "Made in Frankfurt am Main",
	Verfügbarkeit: "Availability",
	Verschlüsselung: "Encryption",
	Zertifiziert: "Certified",
	beginnt: "starts",
	jetzt: "now",
};

const variantVisibleCopy: Record<VariantId, Record<string, string>> = {
	"s-1": {
		"Die Kunst der Zeiterfassung": "The Art of Time Tracking",
		"Zeit fließt.": "Time flows.",
		"Fangen Sie": "Capture",
		"sie ein.": "it.",
		"Wie Tusche auf Papier — jede Sekunde hinterlässt eine Spur. Z8 verwandelt flüchtige Momente in bleibende Klarheit. Stempeluhr, Berichte, Schichtplanung und Lohnexport — in einem Werkzeug.":
			"Like ink on paper - every second leaves a trace. Z8 turns fleeting moments into lasting clarity. Time clock, reports, scheduling, and payroll export - in one tool.",
		Starten: "Start",
		"Vertraut von über 10.000 Unternehmen": "Trusted by more than 10,000 companies",
		"Reduziert auf das Wesentliche": "Reduced to the essentials",
		"Ein Klick genügt. Start, Stopp, Pause — auf Web, Desktop und Mobilgerät. Echtzeit-Synchronisation über alle Geräte.":
			"One click is enough. Start, stop, pause - on web, desktop, and mobile. Real-time sync across every device.",
		"Berichte & Analyse": "Reports & Analytics",
		"Echtzeit-Dashboards zeigen Überstunden, Trends und Auslastung. Klare Übersichten, die für sich sprechen.":
			"Real-time dashboards show overtime, trends, and workload. Clear views that speak for themselves.",
		"Schichten erstellen, zuweisen und verwalten. Automatische Konflikterkennung und Benachrichtigungen.":
			"Create, assign, and manage shifts. Automatic conflict detection and notifications.",
		"Automatischer Export zu DATEV, Lexware und Personio. Fehlerfrei, pünktlich, revisionssicher.":
			"Automatic export to DATEV, Lexware, and Personio. Error-free, on time, audit-proof.",
		"Urlaubsanträge, Genehmigungen und Resttagekontingente — alles digital, alles transparent.":
			"Leave requests, approvals, and remaining balances - all digital, all transparent.",
		"Automatische Berechnung, Auf- und Abbau, flexible Regeln pro Mitarbeiter oder Abteilung.":
			"Automatic calculation, accrual and reduction, flexible rules per employee or department.",
		"Drei Pinselstriche genügen": "Three brushstrokes are enough",
		"Konto erstellen in unter 60 Sekunden. Keine Kreditkarte, keine Bindung. Team per E-Mail einladen.":
			"Create an account in under 60 seconds. No credit card, no commitment. Invite your team by email.",
		"Mitarbeiter stempeln per Klick — am PC, Tablet oder Smartphone. GPS-Stempel für Außendienst optional.":
			"Employees clock in with one click - on desktop, tablet, or smartphone. Optional GPS stamps for field teams.",
		"Berichte generieren sich automatisch. Export an den Steuerberater oder direkt ins Lohnsystem.":
			"Reports generate automatically. Export to your tax advisor or directly into payroll.",
		"Ihr Dashboard": "Your Dashboard",
		"Alles auf einen Blick — wer arbeitet, wer pausiert, wer im Urlaub ist.":
			"Everything at a glance - who is working, on break, or on leave.",
		"Skaliert mit Ihrem Unternehmen": "Scales with your company",
		"Von 2 bis 20.000 Mitarbeiter — Z8 wächst mit Ihnen. Mandantenfähig, mit isolierten Organisationen und rollenbasierter Zugriffskontrolle.":
			"From 2 to 20,000 employees - Z8 grows with you. Multi-tenant, with isolated organizations and role-based access control.",
		Mandantenfähig: "Multi-tenant",
		"Mehrere Organisationen unter einem Dach, strikt getrennt.":
			"Multiple organizations under one roof, strictly separated.",
		"nahtlose IT-Integration": "seamless IT integration",
		"Rollenbasierte Rechte": "Role-Based Permissions",
		"Admin, Manager, Mitarbeiter — granular steuerbar.":
			"Admin, manager, employee - granularly controllable.",
		Revisionssicher: "Audit-proof",
		Rechtssicher: "Legally compliant",
		"Jeder Eintrag ist unveränderbar protokolliert. Z8 erfüllt alle Anforderungen an die digitale Arbeitszeiterfassung nach deutschem Recht.":
			"Every entry is immutably logged. Z8 meets the requirements for digital working-time records under German law.",
		Konform: "Compliant",
		Zertifiziert: "Certified",
		Verschlüsselung: "Encryption",
		"Verbindet sich nahtlos": "Connects seamlessly",
		"Z8 fügt sich in Ihren bestehenden Workflow ein — nicht umgekehrt. Automatische Datenübernahme, kein manuelles Abtippen.":
			"Z8 fits into your existing workflow - not the other way around. Automatic data transfer, no manual retyping.",
		"Lohndaten automatisch übertragen": "Transfer payroll data automatically",
		"Nahtloser Buchhaltungs-Export": "Seamless accounting export",
		"HR-Daten synchronisieren": "Sync HR data",
		"Stempel-Benachrichtigungen": "Clock-in notifications",
		"Kalender-Synchronisation": "Calendar sync",
		"Stempeln direkt im Chat": "Clock in directly from chat",
		"Eigene Integrationen bauen": "Build custom integrations",
		Plattformen: "Platforms",
		"Überall. Jederzeit.": "Everywhere. Anytime.",
		"Web-App, native Desktop-App für Windows und Mac, mobile Apps für iOS und Android. Alles synchron, alles in Echtzeit.":
			"Web app, native desktop apps for Windows and Mac, mobile apps for iOS and Android. Everything synced, everything real time.",
		"Aktive Nutzer": "Active Users",
		Verfügbarkeit: "Availability",
		Erfassungszeit: "Tracking Time",
		Bewertung: "Rating",
		Stimmen: "Voices",
		"Was unsere Kunden sagen": "What our customers say",
		"Z8 hat unsere Lohnbuchhaltung um 4 Stunden pro Woche entlastet. Der DATEV-Export funktioniert einwandfrei.":
			"Z8 reduced our payroll accounting workload by 4 hours per week. The DATEV export works perfectly.",
		"Geschäftsführer, 85 Mitarbeiter": "Managing Director, 85 employees",
		"Endlich eine Zeiterfassung, die unsere Außendienstler genauso einfach nutzen wie das Büro-Team.":
			"Finally, time tracking our field staff can use just as easily as the office team.",
		"HR-Leiterin, 220 Mitarbeiter": "Head of HR, 220 employees",
		"Die Schichtplanung allein hat sich sofort bezahlt gemacht. Keine Excel-Dateien mehr, keine Konflikte.":
			"Shift planning alone paid for itself immediately. No more Excel files, no more conflicts.",
		"Produktionsleiter, 140 Mitarbeiter": "Production Manager, 140 employees",
		"Revisionssicher, DSGVO-konform und die Mitarbeiter lieben die App. Was will man mehr?":
			"Audit-proof, GDPR-compliant, and employees love the app. What more could you want?",
		Steuerberaterin: "Tax Advisor",
		"Einfach. Transparent.": "Simple. Transparent.",
		"Keine versteckten Kosten. Jederzeit kündbar.": "No hidden costs. Cancel anytime.",
		"für immer": "forever",
		"pro Nutzer / Monat": "per user / month",
		"auf Anfrage": "on request",
		"Bis 5 Mitarbeiter": "Up to 5 employees",
		"Basis-Berichte": "Basic reports",
		"Unbegrenzte Mitarbeiter": "Unlimited employees",
		"Prioritäts-Support": "Priority support",
		"Alles aus Business": "Everything in Business",
		Mandantenfähigkeit: "Multi-tenancy",
		"Dedizierter Ansprechpartner": "Dedicated contact",
		Kontaktieren: "Contact us",
		"Häufige Fragen": "Frequently Asked Questions",
		Antworten: "Answers",
		"Ist Z8 wirklich kostenlos?": "Is Z8 really free?",
		"Ja. Der Starter-Plan für bis zu 5 Mitarbeiter ist dauerhaft kostenlos — ohne Kreditkarte, ohne Ablaufdatum.":
			"Yes. The Starter plan for up to 5 employees is permanently free - no credit card, no expiration date.",
		"Wie funktioniert der DATEV-Export?": "How does the DATEV export work?",
		"Z8 generiert automatisch eine DATEV-konforme Exportdatei. Ein Klick, und die Daten sind bei Ihrem Steuerberater.":
			"Z8 automatically generates a DATEV-compliant export file. One click, and the data is with your tax advisor.",
		"Wo werden meine Daten gespeichert?": "Where is my data stored?",
		"Ausschließlich auf deutschen Servern, AES-256 verschlüsselt, ISO 27001 zertifiziert. Ihre Daten verlassen nie die EU.":
			"Exclusively on German servers, AES-256 encrypted, ISO 27001 certified. Your data never leaves the EU.",
		"Kann ich Z8 mit meiner bestehenden Software verbinden?":
			"Can I connect Z8 to my existing software?",
		"Ja. Neben den fertigen Integrationen (DATEV, Lexware, Personio, SAP) bieten wir eine vollständige REST-API.":
			"Yes. Alongside ready-made integrations (DATEV, Lexware, Personio, SAP), we offer a complete REST API.",
		"Erfüllt Z8 die gesetzlichen Anforderungen?": "Does Z8 meet legal requirements?",
		"Vollständig. GoBD-konform, revisionssicher, DSGVO-zertifiziert. Jeder Eintrag ist unveränderbar protokolliert.":
			"Fully. GoBD-compliant, audit-proof, and GDPR-certified. Every entry is immutably logged.",
		"Bereit für Klarheit?": "Ready for clarity?",
		"Starten Sie heute mit Z8 und erleben Sie Zeiterfassung, die sich wie Intuition anfühlt. Kostenlos, unverbindlich, in unter einer Minute eingerichtet.":
			"Start with Z8 today and experience time tracking that feels intuitive. Free, no commitment, set up in under a minute.",
		"Demo anfragen": "Request a demo",
		"Die Kunst der": "The art of",
	},
	"s-2": {
		"So gehts": "How it works",
		Loslegen: "Get started",
		"Einfach. Natürlich. Zuverlässig.": "Simple. Natural. Reliable.",
		"Zeiterfassung,": "Time tracking",
		"die sich": "that",
		anfühlt: "feels",
		"wie Natur.": "like nature.",
		"Rund geschliffen, glatt und verlässlich — Z8 ist das Werkzeug, das in der Hand liegt, als wäre es schon immer da gewesen.":
			"Rounded, smooth, and dependable - Z8 is the tool that feels like it has always belonged in your hand.",
		"Glatt geschliffen": "Smoothed down",
		"Jede Funktion, reduziert auf ihre beste Form.": "Every feature reduced to its best form.",
		"Ein-Klick Stempel": "One-Click Clock-In",
		"Kein Formular, kein Suchen. Antippen und die Zeit läuft.":
			"No forms, no searching. Tap once and time starts running.",
		"Alle Daten in Echtzeit, klar sortiert und sofort verständlich.":
			"All data in real time, clearly sorted and instantly understood.",
		"Team-Übersicht": "Team Overview",
		"Wer arbeitet, wer pausiert — auf einen Blick für Ihr ganzes Team.":
			"Who is working, who is on break - one view for your whole team.",
		"In drei Schritten": "In three steps",
		"Team einladen": "Invite your team",
		"Konto erstellen in unter einer Minute. Keine Kreditkarte.":
			"Create an account in under a minute. No credit card.",
		"Mitarbeiter per Link hinzufügen. Sofort einsatzbereit.":
			"Add employees by link. Ready immediately.",
		"Zeit erfassen": "Track time",
		"Stempeln, pausieren, Berichte ziehen. Fertig.": "Clock in, pause, pull reports. Done.",
		"Bereit für etwas": "Ready for something",
		Rundes: "well-rounded",
	},
	"s-3": {
		"sys::zeiterfassung": "sys::time-tracking",
		"[funktionen]": "[features]",
		"[kontakt]": "[contact]",
		ZEIT: "TIME",
		IST: "IS",
		CODE: "CODE",
		"Jede Millisekunde erfasst. Jeder Prozess optimiert. Z8 ist das Betriebssystem für Ihre Arbeitszeit.":
			"Every millisecond captured. Every process optimized. Z8 is the operating system for your working time.",
		"System-Module": "System Modules",
		"Echtzeit-Tracking": "Real-Time Tracking",
		"Starten, stoppen, pausieren — alles in Echtzeit synchronisiert.":
			"Start, stop, pause - everything synced in real time.",
		"Berichte generieren sich selbst. Export als CSV, PDF oder JSON.":
			"Reports generate themselves. Export as CSV, PDF, or JSON.",
		"REST-API für alle Endpunkte. Integriert sich in Ihren Stack.":
			"REST API for every endpoint. Integrates with your stack.",
		Verschlüsselt: "Encrypted",
		"Ende-zu-Ende-Verschlüsselung. Ihre Daten bleiben Ihre Daten.":
			"End-to-end encryption. Your data stays yours.",
	},
	"s-4": {
		Geschichte: "Story",
		"Handwerk trifft Technologie": "Craft meets technology",
		"Zeit hat eine": "Time has a",
		Wärme: "warmth",
		"wenn man sie": "when you",
		"versteht.": "understand it.",
		"Wie ein guter Ton, geformt von Hand — Z8 gibt Ihrer Arbeitszeit Form und Struktur. Warm, ehrlich und beständig.":
			"Like fine clay shaped by hand - Z8 gives your working time form and structure. Warm, honest, and steady.",
		"Geformt für den Alltag": "Shaped for everyday work",
		"Start und Stopp mit einem Tippen. So einfach wie ein Lichtschalter.":
			"Start and stop with one tap. As simple as a light switch.",
		Stundenzettel: "Timesheets",
		"Automatisch generiert, immer aktuell, bereit zum Export.":
			"Automatically generated, always current, ready to export.",
		Projekte: "Projects",
		"Zeiten nach Projekt erfassen und zuordnen. Ohne Umwege.":
			"Track and assign time by project. Without detours.",
		Übersicht: "Overview",
		"Ihr Dashboard zeigt, was zählt. Keine Ablenkung.":
			"Your dashboard shows what matters. No distractions.",
		"Die beste Technologie ist die, die man nicht bemerkt — die einfach funktioniert, wie ein warmer Raum.":
			"The best technology is the kind you do not notice - it simply works, like a warm room.",
		"Formen Sie Ihre Zeit.": "Shape your time.",
	},
	"s-5": {
		Vorteile: "Benefits",
		"Kristallklare Zeiterfassung": "Crystal-clear time tracking",
		Durchsichtig: "Transparent.",
		Durchdacht: "Thoughtful.",
		"Wie gefrostetes Glas — Z8 zeigt genau das, was Sie brauchen, und blendet alles andere aus. Reine Klarheit.":
			"Like frosted glass - Z8 shows exactly what you need and filters out everything else. Pure clarity.",
		"Schicht für Schicht": "Layer by layer",
		"Ein-Klick Start": "One-Click Start",
		"Stempeln ohne Nachdenken. Die Uhr läuft ab dem ersten Tippen.":
			"Clock in without thinking. The clock starts with the first tap.",
		"Glasklare Berichte": "Crystal-Clear Reports",
		"Daten, die sich von selbst erklären. Kein Rätselraten.":
			"Data that explains itself. No guessing.",
		"Team-Transparenz": "Team Transparency",
		"Jeder sieht, was er braucht. Nicht mehr, nicht weniger.":
			"Everyone sees what they need. No more, no less.",
		"Sehen Sie klar.": "See clearly.",
		"Starten Sie heute — kostenlos und unverbindlich.":
			"Start today - free and without commitment.",
	},
	"s-6": {
		Skizze: "Sketch",
		"Los gehts!": "Let's go!",
		"* notiert am Whiteboard:": "* written on the whiteboard:",
		aufschreiben: "writing down",
		"war nie": "was never",
		"so einfach.": "this easy.",
		"Kein fancy Dashboard nötig. Kein Schnickschnack. Z8 ist wie ein Block und ein Stift — nur digital.":
			"No fancy dashboard needed. No clutter. Z8 is like a notepad and pen - just digital.",
		"Jetzt ausprobieren ✎": "Try it now ✎",
		"~ skizze": "~ sketch",
		"Was Z8 kann:": "What Z8 can do:",
		Stempeln: "Clocking in",
		"Ein Klick, die Zeit läuft. Nochmal klicken, Feierabend.":
			"One click, time runs. Click again, done for the day.",
		"Wer hat wann was gemacht? Alles auf einer Seite.":
			"Who did what when? Everything on one page.",
		Export: "Export",
		"Daten raus als CSV oder PDF. Für den Steuerberater.":
			"Send data out as CSV or PDF. For your tax advisor.",
		Team: "Team",
		"Mitarbeiter einladen, Zeiten vergleichen, fertig.": "Invite employees, compare times, done.",
		"Manchmal ist ein Stift alles, was man braucht.": "Sometimes a pen is all you need.",
		"Das Z8 Team": "The Z8 Team",
		"Stift gezückt?": "Pen ready?",
		"Jetzt starten ✎": "Start now ✎",
	},
	"s-7": {
		Handwerk: "Craft",
		"Oxidiert, nicht veraltet": "Oxidized, not outdated",
		"Beständig wie": "Durable as",
		Kupfer: "Copper",
		"Kupfer wird mit der Zeit nicht schwächer — es entwickelt Charakter. Z8 ist die Zeiterfassung, die mit Ihrem Unternehmen reift.":
			"Copper does not weaken over time - it develops character. Z8 is time tracking that matures with your company.",
		Module: "Modules",
		"Präzise Zeiterfassung, ein Klick zum Start, ein Klick zum Ende.":
			"Precise time tracking, one click to start, one click to finish.",
		"Echtzeit-Übersicht über alle Mitarbeiter und laufende Projekte.":
			"Real-time overview of all employees and active projects.",
		"Automatische Monats- und Projektberichte, exportbereit.":
			"Automatic monthly and project reports, ready to export.",
		"Software, die Patina ansetzt, statt zu veralten — das ist unser Versprechen.":
			"Software that develops patina instead of becoming outdated - that is our promise.",
		"Jahre am Markt": "Years on the market",
		Nutzer: "Users",
		"Bereit für": "Ready for",
		Beständigkeit: "durability",
	},
	"s-8": {
		"Ausgabe Nr. 1 — 2025": "Issue No. 1 - 2025",
		"Donnerstag, 6. Februar": "Thursday, February 6",
		"Z8 Anzeiger": "Z8 Gazette",
		"Die Zeitung für moderne Zeiterfassung": "The newspaper for modern time tracking",
		Titelstory: "Lead Story",
		Rubriken: "Sections",
		Abonnement: "Subscription",
		Exklusiv: "Exclusive",
		"Zeiterfassung revolutioniert:": "Time tracking revolutionized:",
		"Z8 macht Schluss mit Zettelwirtschaft": "Z8 puts an end to paper chaos",
		"Das Frankfurter Startup Z8 präsentiert eine neue Generation der Arbeitszeiterfassung. Schluss mit Excel-Tabellen, handgeschriebenen Stundenzetteln und verlorenen Daten.":
			"Frankfurt startup Z8 presents a new generation of workforce time tracking. No more Excel sheets, handwritten timesheets, or lost data.",
		"Mit nur einem Klick erfassen Mitarbeiter ihre Arbeitszeit — präzise, digital und in Echtzeit. Das Dashboard zeigt sofort alle relevanten Kennzahlen auf einen Blick.":
			"With one click, employees record working time - precisely, digitally, and in real time. The dashboard instantly shows every relevant metric at a glance.",
		"Besonders für kleine und mittlere Unternehmen ist Z8 eine Offenbarung: Einfach einrichten, Team einladen und sofort loslegen. Keine Schulung nötig.":
			"For small and medium-sized businesses in particular, Z8 is a revelation: set it up, invite the team, and start immediately. No training required.",
		Kurzmeldungen: "Briefs",
		"10.000 Nutzer vertrauen bereits auf Z8": "10,000 users already trust Z8",
		"DSGVO-konforme Datenhaltung auf deutschen Servern":
			"GDPR-compliant data storage on German servers",
		"Neue API-Schnittstellen für SAP und DATEV": "New API interfaces for SAP and DATEV",
		Anzeige: "Advertisement",
		"Jetzt 30 Tage kostenlos": "Now free for 30 days",
		Testen: "Try it",
		"Team-Meeting bei einem Z8-Kunden in Frankfurt. Foto: Archiv":
			"Team meeting at a Z8 customer in Frankfurt. Photo: archive",
		"Modernes Büro mit Z8-Integration": "Modern office with Z8 integration",
		"Die digitale Stechuhr für das 21. Jahrhundert. Start, Pause, Ende — alles mit einem Fingertipp. Funktioniert auf Smartphone, Tablet und Desktop gleichermassen.":
			"The digital time clock for the 21st century. Start, pause, finish - all with one tap. Works equally well on smartphone, tablet, and desktop.",
		"Berichte & Export": "Reports & Export",
		"Monatsberichte generieren sich automatisch. Export in CSV, PDF oder direkt an Ihren Steuerberater. Keine manuelle Nacharbeit mehr nötig.":
			"Monthly reports generate automatically. Export to CSV, PDF, or directly to your tax advisor. No manual follow-up required.",
		"Team-Verwaltung": "Team Management",
		"Mitarbeiter per E-Mail einladen, Rollen zuweisen, Arbeitszeiten überblicken. Alles an einem Ort. Für Teams von 2 bis 2.000.":
			"Invite employees by email, assign roles, review working hours. Everything in one place. For teams from 2 to 2,000.",
		Kleinanzeige: "Classified",
		"Z8 — Jetzt abonnieren.": "Z8 - Subscribe now.",
		"Kostenlos starten. Keine Kreditkarte erforderlich. Jederzeit kündbar.":
			"Start free. No credit card required. Cancel anytime.",
		"Alle Rechte vorbehalten": "All rights reserved",
	},
	"s-9": {
		Vorteile: "Benefits",
		"Ein neuer Tag beginnt": "A new day begins",
		"Jeder Morgen.": "Every morning.",
		"Jede Minute.": "Every minute.",
		"Zählt.": "Counts.",
		"Wie der erste Lichtstrahl am Horizont — Z8 bringt Wärme und Klarheit in Ihre tägliche Zeiterfassung.":
			"Like the first beam of light on the horizon - Z8 brings warmth and clarity to daily time tracking.",
		"Warm. Klar. Einfach.": "Warm. Clear. Simple.",
		Zeitstempel: "Time Stamps",
		"Start und Stopp — so schnell wie ein Sonnenaufgang.": "Start and stop - as fast as a sunrise.",
		"Automatische Zusammenfassungen, die leuchten vor Klarheit.":
			"Automatic summaries that glow with clarity.",
		Teamwork: "Teamwork",
		"Alle Mitarbeiter auf einem Dashboard. In Echtzeit.":
			"Every employee on one dashboard. In real time.",
		"Z8 hat unseren Morgen verändert. Kein Stress mehr, keine Zettel — nur Klarheit ab dem ersten Kaffee.":
			"Z8 changed our mornings. No more stress, no paper - just clarity from the first coffee.",
		Teamleiterin: "Team Lead",
		Zufriedenheit: "Satisfaction",
		"Der Tag wartet nicht.": "The day does not wait.",
	},
	"s-10": {
		Anmelden: "Log in",
		"Neu: Team-Kalender": "New: Team Calendar",
		Präzision: "Precision",
		"in jeder": "in every",
		Sekunde: "second",
		"Wie Schweizer Uhrmacherei — Z8 verbindet Präzision mit Einfachheit. Keine überflüssigen Teile, jedes Zahnrad hat seinen Platz.":
			"Like Swiss watchmaking - Z8 combines precision with simplicity. No unnecessary parts, every gear in its place.",
		Heute: "Today",
		Woche: "Week",
		Monat: "Month",
		Mo: "Mon",
		Di: "Tue",
		Mi: "Wed",
		Do: "Thu",
		Fr: "Fri",
		Sa: "Sat",
		So: "Sun",
		"Gebaut für Genauigkeit": "Built for accuracy",
		"Jede Funktion an ihrem exakten Platz.": "Every feature in its exact place.",
		Stempeln: "Clock In",
		"Ein Klick, sofort erfasst.": "One click, instantly recorded.",
		"Auto-generiert, exportbereit.": "Auto-generated, ready to export.",
		"Zeit nach Projekt zuordnen.": "Assign time by project.",
		"REST-Endpunkte für alles.": "REST endpoints for everything.",
		Reaktionszeit: "Response Time",
		"Präzision beginnt jetzt.": "Precision starts now.",
	},
};

export function variantTranslationCopy(variantId: VariantId): Record<string, string> {
	return { ...commonVisibleCopy, ...variantVisibleCopy[variantId] };
}

function translateText(value: string, dictionary: Record<string, string>): string {
	let translated = value;

	for (const [source, target] of Object.entries(dictionary).sort(
		(a, b) => b[0].length - a[0].length,
	)) {
		translated = translated.split(source).join(target);
	}

	return translated;
}

export function translateVariantTree(
	locale: Locale,
	variantId: VariantId,
	node: ReactNode,
): ReactNode {
	if (locale === "de") {
		return node;
	}

	const dictionary = variantTranslationCopy(variantId);

	function translate(nodeToTranslate: ReactNode): ReactNode {
		if (typeof nodeToTranslate === "string") {
			return translateText(nodeToTranslate, dictionary);
		}

		if (Array.isArray(nodeToTranslate)) {
			return nodeToTranslate.map((child) => translate(child));
		}

		if (!isValidElement(nodeToTranslate)) {
			return nodeToTranslate;
		}

		const props = nodeToTranslate.props as { children?: ReactNode };

		if (props.children === undefined) {
			return nodeToTranslate;
		}

		return cloneElement(nodeToTranslate, undefined, translate(props.children));
	}

	return translate(node);
}
