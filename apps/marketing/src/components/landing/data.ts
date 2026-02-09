/* ─── Static data for landing page sections ─── */

export const features = [
	"Stempeluhr", "GoBD-konform", "Lohnexport", "Multi-Tenant",
	"Enterprise-SSO", "Echtzeit-Analyse", "Dashboards", "Automatisierung",
	"DATEV-Export", "Schichtplanung",
];

export const logos = ["DATEV", "Lexware", "Personio", "SAP", "Sage"];

export const stats = [
	{ value: "2.400+", label: "Unternehmen", sub: "vertrauen auf Z8" },
	{ value: "99,98%", label: "Uptime", sub: "seit 2022" },
	{ value: "340k", label: "Mitarbeiter", sub: "erfassen täglich" },
	{ value: "<2s", label: "Ladezeit", sub: "Median weltweit" },
];

export const detailedFeatures = [
	{
		tag: "Stempeluhr",
		title: "Ein Klick. Überall.",
		desc: "Ihre Mitarbeiter stempeln per Web, iOS, Android, Terminal oder NFC-Badge ein. Alles synchronisiert sich in Echtzeit \u2014 auch offline. Geo-Fencing und IP-Whitelisting verhindern Missbrauch, ohne ehrliche Mitarbeiter zu behindern.",
		image: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80&auto=format&fit=crop",
	},
	{
		tag: "Analyse",
		title: "Daten, die Entscheidungen treiben.",
		desc: "Überstunden-Trends, Abwesenheits-Muster, Abteilungsvergleiche. Dutzende vorgefertigte Reports plus ein SQL-Editor für Power-User. Automatischer Versand als PDF oder CSV an Stakeholder \u2014 täglich, wöchentlich oder monatlich.",
		image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80&auto=format&fit=crop",
	},
	{
		tag: "Lohnexport",
		title: "Null manuelle Schritte.",
		desc: "Verbinden Sie Z8 direkt mit DATEV, Lexware, Sage, Personio oder SAP. Monatliche Lohndaten werden automatisch übertragen \u2014 ohne CSV-Download, ohne Copy-Paste, ohne Fehler. Ihre Buchhaltung liebt es.",
		image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80&auto=format&fit=crop",
	},
];

export const testimonials = [
	{
		quote: "Wir haben drei Tools durch Z8 ersetzt. Die Zeitersparnis in der HR-Abteilung ist spürbar \u2014 mindestens 8 Stunden pro Woche.",
		name: "Dr. Katharina Voss",
		role: "Head of People, Finleap",
		avatar: "KV",
	},
	{
		quote: "GoBD-Konformität war für uns ein Muss. Z8 ist das einzige Tool, das das sauber löst und gleichzeitig schön aussieht.",
		name: "Markus Hein",
		role: "Geschäftsführer, Hein & Partner",
		avatar: "MH",
	},
	{
		quote: "Unser Onboarding dauert jetzt 3 Minuten statt 2 Tage. Die SCIM-Integration mit unserem IdP funktioniert einwandfrei.",
		name: "Sophie Brandt",
		role: "IT-Leiterin, Commerz Real",
		avatar: "SB",
	},
];

export const pricingPlans = [
	{
		name: "Starter",
		price: "0",
		period: "für immer",
		desc: "Für kleine Teams, die einfach starten wollen.",
		features: ["Bis 10 Mitarbeiter", "Stempeluhr & Dashboard", "Basis-Berichte", "E-Mail-Support", "1 Standort"],
		cta: "Kostenlos starten",
		highlighted: false,
	},
	{
		name: "Business",
		price: "4,90",
		period: "pro Mitarbeiter / Monat",
		desc: "Für wachsende Unternehmen mit Struktur.",
		features: ["Unbegrenzte Mitarbeiter", "DATEV & Lexware Export", "GoBD-konform", "Multi-Standort", "Schichtplanung", "Priorisierter Support"],
		cta: "14 Tage testen",
		highlighted: true,
	},
	{
		name: "Enterprise",
		price: "Individuell",
		period: "ab 200 Mitarbeiter",
		desc: "Für Konzerne mit höchsten Anforderungen.",
		features: ["Alles aus Business", "Enterprise-SSO (SAML)", "SCIM-Provisioning", "Eigener Account Manager", "SLA 99,99%", "On-Premise möglich"],
		cta: "Kontakt aufnehmen",
		highlighted: false,
	},
];

export const integrations = [
	{ name: "DATEV", category: "Lohn" },
	{ name: "Lexware", category: "Lohn" },
	{ name: "SAP", category: "ERP" },
	{ name: "Personio", category: "HR" },
	{ name: "Sage", category: "Lohn" },
	{ name: "Microsoft 365", category: "Identität" },
	{ name: "Google Workspace", category: "Identität" },
	{ name: "Okta", category: "SSO" },
	{ name: "Slack", category: "Kommunikation" },
	{ name: "Jira", category: "Projekt" },
	{ name: "Asana", category: "Projekt" },
	{ name: "Zapier", category: "Automation" },
];

export const comparisons = [
	{ feature: "Stempeluhr (Web + Mobile)", z8: true, others: true },
	{ feature: "GoBD-konforme Archivierung", z8: true, others: false },
	{ feature: "Automatischer Lohnexport", z8: true, others: false },
	{ feature: "Enterprise-SSO (SAML/OIDC)", z8: true, others: false },
	{ feature: "SCIM-Provisioning", z8: true, others: false },
	{ feature: "Multi-Tenant Architektur", z8: true, others: false },
	{ feature: "Echtzeit-Dashboards", z8: true, others: true },
	{ feature: "Geo-Fencing", z8: true, others: true },
	{ feature: "SQL-Report-Editor", z8: true, others: false },
	{ feature: "API-Zugang", z8: true, others: true },
];

export const faqs = [
	{
		q: "Wie schnell kann ich Z8 einrichten?",
		a: "Die meisten Teams sind in unter 5 Minuten startklar. Erstellen Sie ein Konto, laden Sie Mitarbeiter per E-Mail ein \u2014 fertig. Für Enterprise-Kunden mit SSO-Integration rechnen wir mit 1\u20132 Werktagen.",
	},
	{
		q: "Ist Z8 wirklich GoBD-konform?",
		a: "Ja. Alle Zeiteinträge werden revisionssicher gespeichert. Nachträgliche Änderungen werden dokumentiert und sind jederzeit nachvollziehbar. Wir arbeiten mit spezialisierten Wirtschaftsprüfern zusammen.",
	},
	{
		q: "Kann ich Z8 mit meiner bestehenden Lohnsoftware verbinden?",
		a: "Absolut. Wir unterstützen DATEV, Lexware, Sage, Personio und SAP out-of-the-box. Für andere Systeme bieten wir eine REST-API und Zapier-Integration.",
	},
	{
		q: "Was passiert, wenn das Internet ausfällt?",
		a: "Die Z8-App funktioniert offline. Stempelungen werden lokal gespeichert und automatisch synchronisiert, sobald die Verbindung wiederhergestellt ist.",
	},
	{
		q: "Gibt es eine Mindestvertragslaufzeit?",
		a: "Nein. Alle Pläne sind monatlich kündbar. Keine versteckten Kosten, keine Langzeitverträge. Sie zahlen nur, was Sie nutzen.",
	},
];

export const footerLinks = {
	Produkt: ["Funktionen", "Preise", "Integrationen", "API", "Changelog", "Roadmap"],
	Unternehmen: ["Über uns", "Karriere", "Blog", "Presse", "Partner"],
	Ressourcen: ["Hilfe-Center", "Dokumentation", "Status", "Webinare", "Tutorials"],
	Rechtliches: ["Datenschutz", "AGB", "Impressum", "Cookie-Einstellungen", "Auftragsverarbeitung"],
};

export const navItems = [
	{ href: "#features", label: "Produkt" },
	{ href: "#detailed", label: "Funktionen" },
	{ href: "#pricing", label: "Preise" },
	{ href: "#integrations", label: "Integrationen" },
	{ href: "#faq", label: "FAQ" },
];

export const featuresGridItems = [
	{ title: "Stempeluhr", desc: "Ein Klick. Alle Geräte. Sofort synchronisiert über Web, Desktop und Mobile." },
	{ title: "GoBD-konform", desc: "Revisionssichere Einträge. Lückenlos dokumentiert und unantastbar." },
	{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei." },
	{ title: "Multi-Tenant", desc: "Mandantenfähig. Jede Organisation strikt isoliert und sicher." },
	{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlose Integration in Ihre IT-Infrastruktur." },
	{ title: "Echtzeit-Analyse", desc: "Überstunden, Trends, Dashboards. Immer live, immer aktuell." },
];

export const howItWorksSteps = [
	{
		step: "01",
		title: "Konto erstellen",
		desc: "Registrieren Sie sich kostenlos. Kein Vertriebsgespräch, keine Kreditkarte. In unter einer Minute.",
	},
	{
		step: "02",
		title: "Team einladen",
		desc: "Laden Sie Mitarbeiter per E-Mail oder SCIM ein. Abteilungen und Standorte konfigurieren.",
	},
	{
		step: "03",
		title: "Loslegen",
		desc: "Stempeluhr aktivieren, Berichte einstellen, Lohnexport verbinden. Alles läuft.",
	},
];

export const galleryImages = [
	"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
	"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
	"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop",
];
