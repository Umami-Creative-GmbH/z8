import type { Locale } from "./locales";

type StableId = string;

const detailedFeatureImages = {
	"time-clock":
		"https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80&auto=format&fit=crop",
	analytics:
		"https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80&auto=format&fit=crop",
	"payroll-export":
		"https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80&auto=format&fit=crop",
} as const;

const largeBannerImage =
	"https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1400&q=80&auto=format&fit=crop";

const galleryImages = [
	"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
	"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
	"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop",
];

const navConfig = {
	product: { id: "product", href: "#features" },
	features: { id: "features", href: "#detailed" },
	pricing: { id: "pricing", href: "#pricing" },
	integrations: { id: "integrations", href: "#integrations" },
	faq: { id: "faq", href: "#faq" },
} as const;

const comparisonAvailability = {
	"time-clock": { z8: true, others: true },
	"gobd-archiving": { z8: true, others: false },
	"payroll-export": { z8: true, others: false },
	"enterprise-sso": { z8: true, others: false },
	"scim-provisioning": { z8: true, others: false },
	"multi-tenant": { z8: true, others: false },
	"real-time-dashboards": { z8: true, others: true },
	"geo-fencing": { z8: true, others: true },
	"sql-report-editor": { z8: true, others: false },
	"api-access": { z8: true, others: true },
} as const;

export type LandingCopy = {
	announcement: {
		badge: string;
		text: string;
	};
	header: {
		brand: string;
		navItems: Array<{ id: StableId; href: string; label: string }>;
		loginCta: string;
		primaryCta: string;
	};
	hero: {
		title: [string, string];
		description: string;
		primaryCta: string;
		ctaNote: [string, string];
		featureLabel: string;
		features: string[];
		mockup: {
			windowTitle: string;
			company: string;
			sidebarItems: string[];
			dateLabel: string;
			activeEmployees: string;
			weekLabel: string;
			monthLabel: string;
			employees: string[];
			timeValue: string;
			status: string;
		};
	};
	logos: {
		label: string;
		items: string[];
	};
	stats: Array<{ value: string; label: string; sub: string }>;
	featuresGrid: {
		eyebrow: string;
		title: string;
		description: string;
		items: Array<{ id: StableId; title: string; desc: string }>;
	};
	detailedFeatures: {
		eyebrow: string;
		title: string;
		learnMoreCta: string;
		items: Array<{ id: StableId; tag: string; title: string; desc: string; image: string }>;
	};
	galleryImages: string[];
	testimonials: {
		eyebrow: string;
		title: string;
		items: Array<{ id: StableId; quote: string; name: string; role: string; avatar: string }>;
	};
	largeBanner: {
		image: string;
		imageAlt: string;
		title: string;
		description: string;
	};
	pricing: {
		eyebrow: string;
		title: string;
		description: string;
		offer: {
			trial: string;
			monthly: string;
			yearly: string;
			taxNote: string;
			cta: string;
		};
	};
	comparisons: {
		eyebrow: string;
		title: string;
		featureColumn: string;
		z8Column: string;
		othersColumn: string;
		items: Array<{ id: StableId; feature: string; z8: boolean; others: boolean }>;
	};
	integrations: {
		eyebrow: string;
		title: string;
		description: string;
		items: Array<{ id: StableId; name: string; category: string }>;
	};
	howItWorks: {
		eyebrow: string;
		title: string;
		steps: Array<{ id: StableId; step: string; title: string; desc: string }>;
	};
	faqs: {
		eyebrow: string;
		title: string;
		items: Array<{ id: StableId; q: string; a: string }>;
	};
	newsletterCta: {
		title: string;
		description: string;
		emailPlaceholder: string;
		button: string;
		note: string;
	};
	finalCta: {
		eyebrow: string;
		title: string;
		description: string;
		primaryCta: string;
		secondaryCta: string;
		note: string;
	};
	footer: {
		brand: string;
		description: string;
		socialLinks: string[];
		linkGroups: Record<string, string[]>;
		copyright: string;
		legalLinks: string[];
		status: string;
	};
};

export const landingCopy: Record<Locale, LandingCopy> = {
	de: {
		announcement: {
			badge: "Neu",
			text: "Z8 v4 ist da: Schneller, schöner, smarter.",
		},
		header: {
			brand: "Z8",
			navItems: [
				{ ...navConfig.product, label: "Produkt" },
				{ ...navConfig.features, label: "Funktionen" },
				{ ...navConfig.pricing, label: "Preise" },
				{ ...navConfig.integrations, label: "Integrationen" },
				{ ...navConfig.faq, label: "FAQ" },
			],
			loginCta: "Anmelden",
			primaryCta: "Kostenlos starten",
		},
		hero: {
			title: ["Zeiterfassung.", "Endlich gelöst."],
			description:
				"Ersetzen Sie Ihre gesamte Tool-Landschaft. Stempeluhr, Lohnexport und Analyse \u2014 alles an einem Ort.",
			primaryCta: "Kostenlos starten",
			ctaNote: ["Dauerhaft kostenlos.", "Keine Kreditkarte."],
			featureLabel: "ALLES IN EINEM WERKZEUG",
			features: [
				"Stempeluhr",
				"GoBD-konform",
				"Lohnexport",
				"Multi-Tenant",
				"Enterprise-SSO",
				"Echtzeit-Analyse",
				"Dashboards",
				"Automatisierung",
				"DATEV-Export",
				"Schichtplanung",
			],
			mockup: {
				windowTitle: "Z8 \u2014 Dashboard",
				company: "Umami GmbH",
				sidebarItems: [
					"Dashboard",
					"Stempeluhr",
					"Mitarbeiter",
					"Berichte",
					"Lohnexport",
					"Einstellungen",
				],
				dateLabel: "Heute, 6. Februar",
				activeEmployees: "12 Mitarbeiter aktiv",
				weekLabel: "Woche",
				monthLabel: "Monat",
				employees: ["Max Müller", "Anna Schmidt", "Lukas Weber"],
				timeValue: "8h 15m",
				status: "Aktiv",
			},
		},
		logos: {
			label: "Vertraut von",
			items: ["DATEV", "Lexware", "Personio", "SAP", "Sage"],
		},
		stats: [
			{ value: "2.400+", label: "Unternehmen", sub: "vertrauen auf Z8" },
			{ value: "99,98%", label: "Uptime", sub: "seit 2022" },
			{ value: "340k", label: "Mitarbeiter", sub: "erfassen täglich" },
			{ value: "<2s", label: "Ladezeit", sub: "Median weltweit" },
		],
		featuresGrid: {
			eyebrow: "Funktionen",
			title: "Alles, was Ihr Team braucht.",
			description:
				"Sechs Kernmodule. Null Kompromisse. Jedes einzelne so gebaut, dass es allein bestehen könnte \u2014 zusammen sind sie unschlagbar.",
			items: [
				{
					id: "time-clock",
					title: "Stempeluhr",
					desc: "Ein Klick. Alle Geräte. Sofort synchronisiert über Web, Desktop und Mobile.",
				},
				{
					id: "gobd-compliance",
					title: "GoBD-konform",
					desc: "Revisionssichere Einträge. Lückenlos dokumentiert und unantastbar.",
				},
				{
					id: "payroll-export",
					title: "Lohnexport",
					desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei.",
				},
				{
					id: "multi-tenant",
					title: "Multi-Tenant",
					desc: "Mandantenfähig. Jede Organisation strikt isoliert und sicher.",
				},
				{
					id: "enterprise-sso",
					title: "Enterprise-SSO",
					desc: "SAML, OIDC, SCIM. Nahtlose Integration in Ihre IT-Infrastruktur.",
				},
				{
					id: "analytics",
					title: "Echtzeit-Analyse",
					desc: "Überstunden, Trends, Dashboards. Immer live, immer aktuell.",
				},
			],
		},
		detailedFeatures: {
			eyebrow: "Im Detail",
			title: "Gebaut für den Alltag.",
			learnMoreCta: "Mehr erfahren",
			items: [
				{
					id: "time-clock",
					tag: "Stempeluhr",
					title: "Ein Klick. Überall.",
					desc: "Ihre Mitarbeiter stempeln per Web, iOS, Android, Terminal oder NFC-Badge ein. Alles synchronisiert sich in Echtzeit \u2014 auch offline. Geo-Fencing und IP-Whitelisting verhindern Missbrauch, ohne ehrliche Mitarbeiter zu behindern.",
					image: detailedFeatureImages["time-clock"],
				},
				{
					id: "analytics",
					tag: "Analyse",
					title: "Daten, die Entscheidungen treiben.",
					desc: "Überstunden-Trends, Abwesenheits-Muster, Abteilungsvergleiche. Dutzende vorgefertigte Reports plus ein SQL-Editor für Power-User. Automatischer Versand als PDF oder CSV an Stakeholder \u2014 täglich, wöchentlich oder monatlich.",
					image: detailedFeatureImages.analytics,
				},
				{
					id: "payroll-export",
					tag: "Lohnexport",
					title: "Null manuelle Schritte.",
					desc: "Verbinden Sie Z8 direkt mit DATEV, Lexware, Sage, Personio oder SAP. Monatliche Lohndaten werden automatisch übertragen \u2014 ohne CSV-Download, ohne Copy-Paste, ohne Fehler. Ihre Buchhaltung liebt es.",
					image: detailedFeatureImages["payroll-export"],
				},
			],
		},
		galleryImages,
		testimonials: {
			eyebrow: "Kundenstimmen",
			title: "Was unsere Kunden sagen.",
			items: [
				{
					id: "katharina-voss",
					quote:
						"Wir haben drei Tools durch Z8 ersetzt. Die Zeitersparnis in der HR-Abteilung ist spürbar \u2014 mindestens 8 Stunden pro Woche.",
					name: "Dr. Katharina Voss",
					role: "Head of People, Finleap",
					avatar: "KV",
				},
				{
					id: "markus-hein",
					quote:
						"GoBD-Konformität war für uns ein Muss. Z8 ist das einzige Tool, das das sauber löst und gleichzeitig schön aussieht.",
					name: "Markus Hein",
					role: "Geschäftsführer, Hein & Partner",
					avatar: "MH",
				},
				{
					id: "sophie-brandt",
					quote:
						"Unser Onboarding dauert jetzt 3 Minuten statt 2 Tage. Die SCIM-Integration mit unserem IdP funktioniert einwandfrei.",
					name: "Sophie Brandt",
					role: "IT-Leiterin, Commerz Real",
					avatar: "SB",
				},
			],
		},
		largeBanner: {
			image: largeBannerImage,
			imageAlt: "Team collaboration",
			title: "Gebaut für Teams, die es ernst meinen.",
			description:
				"Von 3-Personen-Startups bis zu DAX-Konzernen \u2014 Z8 skaliert mit Ihren Anforderungen.",
		},
		pricing: {
			eyebrow: "Preise",
			title: "Einfach. Transparent. Fair.",
			description:
				"Keine versteckten Kosten. Keine langen Verträge. Starten Sie kostenlos und wachsen Sie mit Z8.",
			offer: {
				trial: "14 Tage kostenlos - keine Kreditkarte erforderlich",
				monthly: "4 € pro Nutzer / Monat",
				yearly: "36 € pro Nutzer / Jahr",
				taxNote: "Preise zzgl. MwSt.",
				cta: "14 Tage testen",
			},
		},
		comparisons: {
			eyebrow: "Vergleich",
			title: "Z8 vs. herkömmliche Tools.",
			featureColumn: "Funktion",
			z8Column: "Z8",
			othersColumn: "Andere",
			items: [
				{
					id: "time-clock",
					feature: "Stempeluhr (Web + Mobile)",
					...comparisonAvailability["time-clock"],
				},
				{
					id: "gobd-archiving",
					feature: "GoBD-konforme Archivierung",
					...comparisonAvailability["gobd-archiving"],
				},
				{
					id: "payroll-export",
					feature: "Automatischer Lohnexport",
					...comparisonAvailability["payroll-export"],
				},
				{
					id: "enterprise-sso",
					feature: "Enterprise-SSO (SAML/OIDC)",
					...comparisonAvailability["enterprise-sso"],
				},
				{
					id: "scim-provisioning",
					feature: "SCIM-Provisioning",
					...comparisonAvailability["scim-provisioning"],
				},
				{
					id: "multi-tenant",
					feature: "Multi-Tenant Architektur",
					...comparisonAvailability["multi-tenant"],
				},
				{
					id: "real-time-dashboards",
					feature: "Echtzeit-Dashboards",
					...comparisonAvailability["real-time-dashboards"],
				},
				{ id: "geo-fencing", feature: "Geo-Fencing", ...comparisonAvailability["geo-fencing"] },
				{
					id: "sql-report-editor",
					feature: "SQL-Report-Editor",
					...comparisonAvailability["sql-report-editor"],
				},
				{ id: "api-access", feature: "API-Zugang", ...comparisonAvailability["api-access"] },
			],
		},
		integrations: {
			eyebrow: "Integrationen",
			title: "Verbindet sich mit Ihrem Stack.",
			description: "Z8 integriert sich nahtlos in die Tools, die Ihr Unternehmen bereits nutzt.",
			items: [
				{ id: "datev", name: "DATEV", category: "Lohn" },
				{ id: "lexware", name: "Lexware", category: "Lohn" },
				{ id: "sap", name: "SAP", category: "ERP" },
				{ id: "personio", name: "Personio", category: "HR" },
				{ id: "sage", name: "Sage", category: "Lohn" },
				{ id: "microsoft-365", name: "Microsoft 365", category: "Identität" },
				{ id: "google-workspace", name: "Google Workspace", category: "Identität" },
				{ id: "okta", name: "Okta", category: "SSO" },
				{ id: "slack", name: "Slack", category: "Kommunikation" },
				{ id: "jira", name: "Jira", category: "Projekt" },
				{ id: "asana", name: "Asana", category: "Projekt" },
				{ id: "zapier", name: "Zapier", category: "Automation" },
			],
		},
		howItWorks: {
			eyebrow: "So funktioniert's",
			title: "In 3 Schritten startklar.",
			steps: [
				{
					id: "create-account",
					step: "01",
					title: "Konto erstellen",
					desc: "Registrieren Sie sich kostenlos. Kein Vertriebsgespräch, keine Kreditkarte. In unter einer Minute.",
				},
				{
					id: "invite-team",
					step: "02",
					title: "Team einladen",
					desc: "Laden Sie Mitarbeiter per E-Mail oder SCIM ein. Abteilungen und Standorte konfigurieren.",
				},
				{
					id: "get-started",
					step: "03",
					title: "Loslegen",
					desc: "Stempeluhr aktivieren, Berichte einstellen, Lohnexport verbinden. Alles läuft.",
				},
			],
		},
		faqs: {
			eyebrow: "FAQ",
			title: "Häufig gestellte Fragen.",
			items: [
				{
					id: "setup-speed",
					q: "Wie schnell kann ich Z8 einrichten?",
					a: "Die meisten Teams sind in unter 5 Minuten startklar. Erstellen Sie ein Konto, laden Sie Mitarbeiter per E-Mail ein \u2014 fertig. Für Enterprise-Kunden mit SSO-Integration rechnen wir mit 1\u20132 Werktagen.",
				},
				{
					id: "gobd-compliance",
					q: "Ist Z8 wirklich GoBD-konform?",
					a: "Ja. Alle Zeiteinträge werden revisionssicher gespeichert. Nachträgliche Änderungen werden dokumentiert und sind jederzeit nachvollziehbar. Wir arbeiten mit spezialisierten Wirtschaftsprüfern zusammen.",
				},
				{
					id: "payroll-integration",
					q: "Kann ich Z8 mit meiner bestehenden Lohnsoftware verbinden?",
					a: "Absolut. Wir unterstützen DATEV, Lexware, Sage, Personio und SAP out-of-the-box. Für andere Systeme bieten wir eine REST-API und Zapier-Integration.",
				},
				{
					id: "offline-mode",
					q: "Was passiert, wenn das Internet ausfällt?",
					a: "Die Z8-App funktioniert offline. Stempelungen werden lokal gespeichert und automatisch synchronisiert, sobald die Verbindung wiederhergestellt ist.",
				},
				{
					id: "contract-term",
					q: "Gibt es eine Mindestvertragslaufzeit?",
					a: "Nein. Alle Pläne sind monatlich kündbar. Keine versteckten Kosten, keine Langzeitverträge. Sie zahlen nur, was Sie nutzen.",
				},
			],
		},
		newsletterCta: {
			title: "Immer auf dem Laufenden.",
			description:
				"Produktupdates, Branchen-Insights und Best Practices für Zeiterfassung \u2014 direkt in Ihr Postfach. Kein Spam, jederzeit abmeldbar.",
			emailPlaceholder: "name@firma.de",
			button: "Abonnieren",
			note: "Kein Spam. Maximal 2\u00d7 pro Monat. Jederzeit abmeldbar.",
		},
		finalCta: {
			eyebrow: "Jetzt starten",
			title: "Bereit durchzustarten?",
			description:
				"Starten Sie kostenlos \u2014 keine Kreditkarte, kein Risiko. Kein Vertriebsgespräch nötig.",
			primaryCta: "Kostenlos starten",
			secondaryCta: "Demo anfragen",
			note: "Dauerhaft kostenlos für bis zu 10 Mitarbeiter · Keine Kreditkarte · DSGVO-konform",
		},
		footer: {
			brand: "Z8",
			description:
				"Workforce Management für moderne Unternehmen. Zeiterfassung, Lohnexport und Analyse in einem.",
			socialLinks: ["Li", "X", "GH"],
			linkGroups: {
				Produkt: ["Funktionen", "Preise", "Integrationen", "API", "Changelog", "Roadmap"],
				Unternehmen: ["Über uns", "Karriere", "Blog", "Presse", "Partner"],
				Ressourcen: ["Hilfe-Center", "Dokumentation", "Status", "Webinare", "Tutorials"],
				Rechtliches: [
					"Datenschutz",
					"AGB",
					"Impressum",
					"Cookie-Einstellungen",
					"Auftragsverarbeitung",
				],
			},
			copyright: "© 2025 Z8 GmbH",
			legalLinks: ["Datenschutz", "AGB", "Impressum"],
			status: "Alle Systeme operativ",
		},
	},
	en: {
		announcement: {
			badge: "New",
			text: "Z8 v4 is here: faster, cleaner, smarter.",
		},
		header: {
			brand: "Z8",
			navItems: [
				{ ...navConfig.product, label: "Product" },
				{ ...navConfig.features, label: "Features" },
				{ ...navConfig.pricing, label: "Pricing" },
				{ ...navConfig.integrations, label: "Integrations" },
				{ ...navConfig.faq, label: "FAQ" },
			],
			loginCta: "Sign in",
			primaryCta: "Start for free",
		},
		hero: {
			title: ["Time tracking.", "Finally solved."],
			description:
				"Replace your entire tool stack. Time clock, payroll export, and analytics - all in one place.",
			primaryCta: "Start for free",
			ctaNote: ["Free forever.", "No credit card."],
			featureLabel: "EVERYTHING IN ONE TOOL",
			features: [
				"Time clock",
				"GoBD-compliant",
				"Payroll export",
				"Multi-tenant",
				"Enterprise SSO",
				"Real-time analytics",
				"Dashboards",
				"Automation",
				"DATEV export",
				"Shift planning",
			],
			mockup: {
				windowTitle: "Z8 - Dashboard",
				company: "Umami GmbH",
				sidebarItems: [
					"Dashboard",
					"Time clock",
					"Employees",
					"Reports",
					"Payroll export",
					"Settings",
				],
				dateLabel: "Today, February 6",
				activeEmployees: "12 employees active",
				weekLabel: "Week",
				monthLabel: "Month",
				employees: ["Max Miller", "Anna Schmidt", "Lukas Weber"],
				timeValue: "8h 15m",
				status: "Active",
			},
		},
		logos: {
			label: "Trusted by",
			items: ["DATEV", "Lexware", "Personio", "SAP", "Sage"],
		},
		stats: [
			{ value: "2,400+", label: "companies", sub: "trust Z8" },
			{ value: "99.98%", label: "uptime", sub: "since 2022" },
			{ value: "340k", label: "employees", sub: "track daily" },
			{ value: "<2s", label: "load time", sub: "global median" },
		],
		featuresGrid: {
			eyebrow: "Features",
			title: "Everything your team needs.",
			description:
				"Six core modules. Zero compromises. Each one strong enough to stand alone - unbeatable together.",
			items: [
				{
					id: "time-clock",
					title: "Time clock",
					desc: "One click. Every device. Instantly synced across web, desktop, and mobile.",
				},
				{
					id: "gobd-compliance",
					title: "GoBD-compliant",
					desc: "Audit-proof entries. Fully documented and tamper-resistant.",
				},
				{
					id: "payroll-export",
					title: "Payroll export",
					desc: "DATEV, Lexware, Personio, SAP. Automatic and error-free.",
				},
				{
					id: "multi-tenant",
					title: "Multi-tenant",
					desc: "Built for tenants. Every organization strictly isolated and secure.",
				},
				{
					id: "enterprise-sso",
					title: "Enterprise SSO",
					desc: "SAML, OIDC, SCIM. Seamless integration with your IT infrastructure.",
				},
				{
					id: "analytics",
					title: "Real-time analytics",
					desc: "Overtime, trends, dashboards. Always live, always current.",
				},
			],
		},
		detailedFeatures: {
			eyebrow: "In detail",
			title: "Built for everyday operations.",
			learnMoreCta: "Learn more",
			items: [
				{
					id: "time-clock",
					tag: "Time clock",
					title: "One click. Anywhere.",
					desc: "Your employees clock in from web, iOS, Android, terminal, or NFC badge. Everything syncs in real time - even offline. Geo-fencing and IP allowlisting prevent abuse without slowing honest employees down.",
					image: detailedFeatureImages["time-clock"],
				},
				{
					id: "analytics",
					tag: "Analytics",
					title: "Data that drives decisions.",
					desc: "Overtime trends, absence patterns, department comparisons. Dozens of ready-made reports plus a SQL editor for power users. Send PDFs or CSVs to stakeholders automatically - daily, weekly, or monthly.",
					image: detailedFeatureImages.analytics,
				},
				{
					id: "payroll-export",
					tag: "Payroll export",
					title: "Zero manual steps.",
					desc: "Connect Z8 directly with DATEV, Lexware, Sage, Personio, or SAP. Monthly payroll data transfers automatically - no CSV download, no copy-paste, no errors. Your accounting team will love it.",
					image: detailedFeatureImages["payroll-export"],
				},
			],
		},
		galleryImages,
		testimonials: {
			eyebrow: "Customer voices",
			title: "What our customers say.",
			items: [
				{
					id: "katharina-voss",
					quote:
						"We replaced three tools with Z8. The time savings for our HR team are noticeable - at least 8 hours per week.",
					name: "Dr. Katharina Voss",
					role: "Head of People, Finleap",
					avatar: "KV",
				},
				{
					id: "markus-hein",
					quote:
						"GoBD compliance was non-negotiable for us. Z8 is the only tool that solves it cleanly and still looks great.",
					name: "Markus Hein",
					role: "Managing Director, Hein & Partner",
					avatar: "MH",
				},
				{
					id: "sophie-brandt",
					quote:
						"Our onboarding now takes 3 minutes instead of 2 days. The SCIM integration with our IdP works flawlessly.",
					name: "Sophie Brandt",
					role: "Head of IT, Commerz Real",
					avatar: "SB",
				},
			],
		},
		largeBanner: {
			image: largeBannerImage,
			imageAlt: "Team collaboration",
			title: "Built for teams that mean business.",
			description:
				"From 3-person startups to enterprise groups - Z8 scales with your requirements.",
		},
		pricing: {
			eyebrow: "Pricing",
			title: "Simple. Transparent. Fair.",
			description: "No hidden costs. No long contracts. Start for free and grow with Z8.",
			offer: {
				trial: "14 days free - no credit card required",
				monthly: "4€ per user per month",
				yearly: "36€ per user per year",
				taxNote: "Prices excluding tax",
				cta: "Try 14 days",
			},
		},
		comparisons: {
			eyebrow: "Comparison",
			title: "Z8 vs. traditional tools.",
			featureColumn: "Feature",
			z8Column: "Z8",
			othersColumn: "Others",
			items: [
				{
					id: "time-clock",
					feature: "Time clock (web + mobile)",
					...comparisonAvailability["time-clock"],
				},
				{
					id: "gobd-archiving",
					feature: "GoBD-compliant archiving",
					...comparisonAvailability["gobd-archiving"],
				},
				{
					id: "payroll-export",
					feature: "Automatic payroll export",
					...comparisonAvailability["payroll-export"],
				},
				{
					id: "enterprise-sso",
					feature: "Enterprise SSO (SAML/OIDC)",
					...comparisonAvailability["enterprise-sso"],
				},
				{
					id: "scim-provisioning",
					feature: "SCIM provisioning",
					...comparisonAvailability["scim-provisioning"],
				},
				{
					id: "multi-tenant",
					feature: "Multi-tenant architecture",
					...comparisonAvailability["multi-tenant"],
				},
				{
					id: "real-time-dashboards",
					feature: "Real-time dashboards",
					...comparisonAvailability["real-time-dashboards"],
				},
				{ id: "geo-fencing", feature: "Geo-fencing", ...comparisonAvailability["geo-fencing"] },
				{
					id: "sql-report-editor",
					feature: "SQL report editor",
					...comparisonAvailability["sql-report-editor"],
				},
				{ id: "api-access", feature: "API access", ...comparisonAvailability["api-access"] },
			],
		},
		integrations: {
			eyebrow: "Integrations",
			title: "Connects with your stack.",
			description: "Z8 integrates seamlessly with the tools your company already uses.",
			items: [
				{ id: "datev", name: "DATEV", category: "Payroll" },
				{ id: "lexware", name: "Lexware", category: "Payroll" },
				{ id: "sap", name: "SAP", category: "ERP" },
				{ id: "personio", name: "Personio", category: "HR" },
				{ id: "sage", name: "Sage", category: "Payroll" },
				{ id: "microsoft-365", name: "Microsoft 365", category: "Identity" },
				{ id: "google-workspace", name: "Google Workspace", category: "Identity" },
				{ id: "okta", name: "Okta", category: "SSO" },
				{ id: "slack", name: "Slack", category: "Communication" },
				{ id: "jira", name: "Jira", category: "Project" },
				{ id: "asana", name: "Asana", category: "Project" },
				{ id: "zapier", name: "Zapier", category: "Automation" },
			],
		},
		howItWorks: {
			eyebrow: "How it works",
			title: "Ready in 3 steps.",
			steps: [
				{
					id: "create-account",
					step: "01",
					title: "Create an account",
					desc: "Sign up for free. No sales call, no credit card. In under a minute.",
				},
				{
					id: "invite-team",
					step: "02",
					title: "Invite your team",
					desc: "Invite employees by email or SCIM. Configure departments and locations.",
				},
				{
					id: "get-started",
					step: "03",
					title: "Start tracking",
					desc: "Activate the time clock, set up reports, connect payroll export. Everything runs.",
				},
			],
		},
		faqs: {
			eyebrow: "FAQ",
			title: "Frequently asked questions.",
			items: [
				{
					id: "setup-speed",
					q: "How quickly can I set up Z8?",
					a: "Most teams are ready in under 5 minutes. Create an account, invite employees by email - done. For enterprise customers with SSO integration, expect 1-2 business days.",
				},
				{
					id: "gobd-compliance",
					q: "Is Z8 really GoBD-compliant?",
					a: "Yes. All time entries are stored in an audit-proof way. Later changes are documented and traceable at any time. We work with specialized auditors.",
				},
				{
					id: "payroll-integration",
					q: "Can I connect Z8 to my existing payroll software?",
					a: "Absolutely. We support DATEV, Lexware, Sage, Personio, and SAP out of the box. For other systems, we offer a REST API and Zapier integration.",
				},
				{
					id: "offline-mode",
					q: "What happens if the internet goes down?",
					a: "The Z8 app works offline. Clock-ins are stored locally and synced automatically as soon as the connection is restored.",
				},
				{
					id: "contract-term",
					q: "Is there a minimum contract term?",
					a: "No. All plans can be canceled monthly. No hidden costs, no long-term contracts. You only pay for what you use.",
				},
			],
		},
		newsletterCta: {
			title: "Stay up to date.",
			description:
				"Product updates, industry insights, and time tracking best practices - straight to your inbox. No spam, unsubscribe anytime.",
			emailPlaceholder: "name@company.com",
			button: "Subscribe",
			note: "No spam. Maximum 2x per month. Unsubscribe anytime.",
		},
		finalCta: {
			eyebrow: "Start now",
			title: "Ready to get started?",
			description: "Start for free - no credit card, no risk. No sales call required.",
			primaryCta: "Start for free",
			secondaryCta: "Request a demo",
			note: "Free forever for up to 10 employees · No credit card · GDPR-compliant",
		},
		footer: {
			brand: "Z8",
			description:
				"Workforce management for modern companies. Time tracking, payroll export, and analytics in one.",
			socialLinks: ["Li", "X", "GH"],
			linkGroups: {
				Product: ["Features", "Pricing", "Integrations", "API", "Changelog", "Roadmap"],
				Company: ["About us", "Careers", "Blog", "Press", "Partners"],
				Resources: ["Help Center", "Documentation", "Status", "Webinars", "Tutorials"],
				Legal: ["Privacy", "Terms", "Legal notice", "Cookie settings", "Data processing agreement"],
			},
			copyright: "© 2025 Z8 GmbH",
			legalLinks: ["Privacy", "Terms", "Legal notice"],
			status: "All systems operational",
		},
	},
};
