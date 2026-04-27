import type { Locale } from "./locales";

export type LandingCopy = {
	announcement: {
		badge: string;
		text: string;
	};
	header: {
		brand: string;
		navItems: Array<{ href: string; label: string }>;
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
		items: Array<{ title: string; desc: string }>;
	};
	detailedFeatures: {
		eyebrow: string;
		title: string;
		learnMoreCta: string;
		items: Array<{ tag: string; title: string; desc: string; image: string }>;
	};
	galleryImages: string[];
	testimonials: {
		eyebrow: string;
		title: string;
		items: Array<{ quote: string; name: string; role: string; avatar: string }>;
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
		highlightBadge: string;
		currencyPrefix: string;
		customPrice: string;
		plans: Array<{
			name: string;
			price: string;
			period: string;
			desc: string;
			features: string[];
			cta: string;
			highlighted: boolean;
		}>;
	};
	comparisons: {
		eyebrow: string;
		title: string;
		featureColumn: string;
		z8Column: string;
		othersColumn: string;
		items: Array<{ feature: string; z8: boolean; others: boolean }>;
	};
	integrations: {
		eyebrow: string;
		title: string;
		description: string;
		items: Array<{ name: string; category: string }>;
	};
	howItWorks: {
		eyebrow: string;
		title: string;
		steps: Array<{ step: string; title: string; desc: string }>;
	};
	faqs: {
		eyebrow: string;
		title: string;
		items: Array<{ q: string; a: string }>;
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
				{ href: "#features", label: "Produkt" },
				{ href: "#detailed", label: "Funktionen" },
				{ href: "#pricing", label: "Preise" },
				{ href: "#integrations", label: "Integrationen" },
				{ href: "#faq", label: "FAQ" },
			],
			loginCta: "Anmelden",
			primaryCta: "Kostenlos starten",
		},
		hero: {
			title: ["Zeiterfassung.", "Endlich gelöst."],
			description: "Ersetzen Sie Ihre gesamte Tool-Landschaft. Stempeluhr, Lohnexport und Analyse - alles an einem Ort.",
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
				windowTitle: "Z8 - Dashboard",
				company: "Umami GmbH",
				sidebarItems: ["Dashboard", "Stempeluhr", "Mitarbeiter", "Berichte", "Lohnexport", "Einstellungen"],
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
			description: "Sechs Kernmodule. Null Kompromisse. Jedes einzelne so gebaut, dass es allein bestehen könnte - zusammen sind sie unschlagbar.",
			items: [
				{ title: "Stempeluhr", desc: "Ein Klick. Alle Geräte. Sofort synchronisiert über Web, Desktop und Mobile." },
				{ title: "GoBD-konform", desc: "Revisionssichere Einträge. Lückenlos dokumentiert und unantastbar." },
				{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei." },
				{ title: "Multi-Tenant", desc: "Mandantenfähig. Jede Organisation strikt isoliert und sicher." },
				{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlose Integration in Ihre IT-Infrastruktur." },
				{ title: "Echtzeit-Analyse", desc: "Überstunden, Trends, Dashboards. Immer live, immer aktuell." },
			],
		},
		detailedFeatures: {
			eyebrow: "Im Detail",
			title: "Gebaut für den Alltag.",
			learnMoreCta: "Mehr erfahren",
			items: [
				{
					tag: "Stempeluhr",
					title: "Ein Klick. Überall.",
					desc: "Ihre Mitarbeiter stempeln per Web, iOS, Android, Terminal oder NFC-Badge ein. Alles synchronisiert sich in Echtzeit - auch offline. Geo-Fencing und IP-Whitelisting verhindern Missbrauch, ohne ehrliche Mitarbeiter zu behindern.",
					image: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80&auto=format&fit=crop",
				},
				{
					tag: "Analyse",
					title: "Daten, die Entscheidungen treiben.",
					desc: "Überstunden-Trends, Abwesenheits-Muster, Abteilungsvergleiche. Dutzende vorgefertigte Reports plus ein SQL-Editor für Power-User. Automatischer Versand als PDF oder CSV an Stakeholder - täglich, wöchentlich oder monatlich.",
					image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80&auto=format&fit=crop",
				},
				{
					tag: "Lohnexport",
					title: "Null manuelle Schritte.",
					desc: "Verbinden Sie Z8 direkt mit DATEV, Lexware, Sage, Personio oder SAP. Monatliche Lohndaten werden automatisch übertragen - ohne CSV-Download, ohne Copy-Paste, ohne Fehler. Ihre Buchhaltung liebt es.",
					image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80&auto=format&fit=crop",
				},
			],
		},
		galleryImages: [
			"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
			"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
			"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop",
		],
		testimonials: {
			eyebrow: "Kundenstimmen",
			title: "Was unsere Kunden sagen.",
			items: [
				{
					quote: "Wir haben drei Tools durch Z8 ersetzt. Die Zeitersparnis in der HR-Abteilung ist spürbar - mindestens 8 Stunden pro Woche.",
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
			],
		},
		largeBanner: {
			image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1400&q=80&auto=format&fit=crop",
			imageAlt: "Team collaboration",
			title: "Gebaut für Teams, die es ernst meinen.",
			description: "Von 3-Personen-Startups bis zu DAX-Konzernen - Z8 skaliert mit Ihren Anforderungen.",
		},
		pricing: {
			eyebrow: "Preise",
			title: "Einfach. Transparent. Fair.",
			description: "Keine versteckten Kosten. Keine langen Verträge. Starten Sie kostenlos und wachsen Sie mit Z8.",
			highlightBadge: "Beliebteste Wahl",
			currencyPrefix: "€",
			customPrice: "Individuell",
			plans: [
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
			],
		},
		comparisons: {
			eyebrow: "Vergleich",
			title: "Z8 vs. herkömmliche Tools.",
			featureColumn: "Funktion",
			z8Column: "Z8",
			othersColumn: "Andere",
			items: [
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
			],
		},
		integrations: {
			eyebrow: "Integrationen",
			title: "Verbindet sich mit Ihrem Stack.",
			description: "Z8 integriert sich nahtlos in die Tools, die Ihr Unternehmen bereits nutzt.",
			items: [
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
			],
		},
		howItWorks: {
			eyebrow: "So funktioniert's",
			title: "In 3 Schritten startklar.",
			steps: [
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
			],
		},
		faqs: {
			eyebrow: "FAQ",
			title: "Häufig gestellte Fragen.",
			items: [
				{
					q: "Wie schnell kann ich Z8 einrichten?",
					a: "Die meisten Teams sind in unter 5 Minuten startklar. Erstellen Sie ein Konto, laden Sie Mitarbeiter per E-Mail ein - fertig. Für Enterprise-Kunden mit SSO-Integration rechnen wir mit 1-2 Werktagen.",
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
			],
		},
		newsletterCta: {
			title: "Immer auf dem Laufenden.",
			description: "Produktupdates, Branchen-Insights und Best Practices für Zeiterfassung - direkt in Ihr Postfach. Kein Spam, jederzeit abmeldbar.",
			emailPlaceholder: "name@firma.de",
			button: "Abonnieren",
			note: "Kein Spam. Maximal 2x pro Monat. Jederzeit abmeldbar.",
		},
		finalCta: {
			eyebrow: "Jetzt starten",
			title: "Bereit durchzustarten?",
			description: "Starten Sie kostenlos - keine Kreditkarte, kein Risiko. Kein Vertriebsgespräch nötig.",
			primaryCta: "Kostenlos starten",
			secondaryCta: "Demo anfragen",
			note: "Dauerhaft kostenlos für bis zu 10 Mitarbeiter · Keine Kreditkarte · DSGVO-konform",
		},
		footer: {
			brand: "Z8",
			description: "Workforce Management für moderne Unternehmen. Zeiterfassung, Lohnexport und Analyse in einem.",
			socialLinks: ["Li", "X", "GH"],
			linkGroups: {
				Produkt: ["Funktionen", "Preise", "Integrationen", "API", "Changelog", "Roadmap"],
				Unternehmen: ["Über uns", "Karriere", "Blog", "Presse", "Partner"],
				Ressourcen: ["Hilfe-Center", "Dokumentation", "Status", "Webinare", "Tutorials"],
				Rechtliches: ["Datenschutz", "AGB", "Impressum", "Cookie-Einstellungen", "Auftragsverarbeitung"],
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
				{ href: "#features", label: "Product" },
				{ href: "#detailed", label: "Features" },
				{ href: "#pricing", label: "Pricing" },
				{ href: "#integrations", label: "Integrations" },
				{ href: "#faq", label: "FAQ" },
			],
			loginCta: "Sign in",
			primaryCta: "Start for free",
		},
		hero: {
			title: ["Time tracking.", "Finally solved."],
			description: "Replace your entire tool stack. Time clock, payroll export, and analytics - all in one place.",
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
				sidebarItems: ["Dashboard", "Time clock", "Employees", "Reports", "Payroll export", "Settings"],
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
			description: "Six core modules. Zero compromises. Each one strong enough to stand alone - unbeatable together.",
			items: [
				{ title: "Time clock", desc: "One click. Every device. Instantly synced across web, desktop, and mobile." },
				{ title: "GoBD-compliant", desc: "Audit-proof entries. Fully documented and tamper-resistant." },
				{ title: "Payroll export", desc: "DATEV, Lexware, Personio, SAP. Automatic and error-free." },
				{ title: "Multi-tenant", desc: "Built for tenants. Every organization strictly isolated and secure." },
				{ title: "Enterprise SSO", desc: "SAML, OIDC, SCIM. Seamless integration with your IT infrastructure." },
				{ title: "Real-time analytics", desc: "Overtime, trends, dashboards. Always live, always current." },
			],
		},
		detailedFeatures: {
			eyebrow: "In detail",
			title: "Built for everyday operations.",
			learnMoreCta: "Learn more",
			items: [
				{
					tag: "Time clock",
					title: "One click. Anywhere.",
					desc: "Your employees clock in from web, iOS, Android, terminal, or NFC badge. Everything syncs in real time - even offline. Geo-fencing and IP allowlisting prevent abuse without slowing honest employees down.",
					image: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80&auto=format&fit=crop",
				},
				{
					tag: "Analytics",
					title: "Data that drives decisions.",
					desc: "Overtime trends, absence patterns, department comparisons. Dozens of ready-made reports plus a SQL editor for power users. Send PDFs or CSVs to stakeholders automatically - daily, weekly, or monthly.",
					image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80&auto=format&fit=crop",
				},
				{
					tag: "Payroll export",
					title: "Zero manual steps.",
					desc: "Connect Z8 directly with DATEV, Lexware, Sage, Personio, or SAP. Monthly payroll data transfers automatically - no CSV download, no copy-paste, no errors. Your accounting team will love it.",
					image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80&auto=format&fit=crop",
				},
			],
		},
		galleryImages: [
			"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
			"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
			"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop",
		],
		testimonials: {
			eyebrow: "Customer voices",
			title: "What our customers say.",
			items: [
				{
					quote: "We replaced three tools with Z8. The time savings for our HR team are noticeable - at least 8 hours per week.",
					name: "Dr. Katharina Voss",
					role: "Head of People, Finleap",
					avatar: "KV",
				},
				{
					quote: "GoBD compliance was non-negotiable for us. Z8 is the only tool that solves it cleanly and still looks great.",
					name: "Markus Hein",
					role: "Managing Director, Hein & Partner",
					avatar: "MH",
				},
				{
					quote: "Our onboarding now takes 3 minutes instead of 2 days. The SCIM integration with our IdP works flawlessly.",
					name: "Sophie Brandt",
					role: "Head of IT, Commerz Real",
					avatar: "SB",
				},
			],
		},
		largeBanner: {
			image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1400&q=80&auto=format&fit=crop",
			imageAlt: "Team collaboration",
			title: "Built for teams that mean business.",
			description: "From 3-person startups to enterprise groups - Z8 scales with your requirements.",
		},
		pricing: {
			eyebrow: "Pricing",
			title: "Simple. Transparent. Fair.",
			description: "No hidden costs. No long contracts. Start for free and grow with Z8.",
			highlightBadge: "Most popular",
			currencyPrefix: "€",
			customPrice: "Custom",
			plans: [
				{
					name: "Starter",
					price: "0",
					period: "forever",
					desc: "For small teams that want to get started simply.",
					features: ["Up to 10 employees", "Time clock & dashboard", "Basic reports", "Email support", "1 location"],
					cta: "Start for free",
					highlighted: false,
				},
				{
					name: "Business",
					price: "4.90",
					period: "per employee / month",
					desc: "For growing companies with structure.",
					features: ["Unlimited employees", "DATEV & Lexware export", "GoBD-compliant", "Multiple locations", "Shift planning", "Priority support"],
					cta: "Try 14 days",
					highlighted: true,
				},
				{
					name: "Enterprise",
					price: "Custom",
					period: "from 200 employees",
					desc: "For enterprises with the highest requirements.",
					features: ["Everything in Business", "Enterprise SSO (SAML)", "SCIM provisioning", "Dedicated account manager", "99.99% SLA", "On-premise available"],
					cta: "Contact us",
					highlighted: false,
				},
			],
		},
		comparisons: {
			eyebrow: "Comparison",
			title: "Z8 vs. traditional tools.",
			featureColumn: "Feature",
			z8Column: "Z8",
			othersColumn: "Others",
			items: [
				{ feature: "Time clock (web + mobile)", z8: true, others: true },
				{ feature: "GoBD-compliant archiving", z8: true, others: false },
				{ feature: "Automatic payroll export", z8: true, others: false },
				{ feature: "Enterprise SSO (SAML/OIDC)", z8: true, others: false },
				{ feature: "SCIM provisioning", z8: true, others: false },
				{ feature: "Multi-tenant architecture", z8: true, others: false },
				{ feature: "Real-time dashboards", z8: true, others: true },
				{ feature: "Geo-fencing", z8: true, others: true },
				{ feature: "SQL report editor", z8: true, others: false },
				{ feature: "API access", z8: true, others: true },
			],
		},
		integrations: {
			eyebrow: "Integrations",
			title: "Connects with your stack.",
			description: "Z8 integrates seamlessly with the tools your company already uses.",
			items: [
				{ name: "DATEV", category: "Payroll" },
				{ name: "Lexware", category: "Payroll" },
				{ name: "SAP", category: "ERP" },
				{ name: "Personio", category: "HR" },
				{ name: "Sage", category: "Payroll" },
				{ name: "Microsoft 365", category: "Identity" },
				{ name: "Google Workspace", category: "Identity" },
				{ name: "Okta", category: "SSO" },
				{ name: "Slack", category: "Communication" },
				{ name: "Jira", category: "Project" },
				{ name: "Asana", category: "Project" },
				{ name: "Zapier", category: "Automation" },
			],
		},
		howItWorks: {
			eyebrow: "How it works",
			title: "Ready in 3 steps.",
			steps: [
				{
					step: "01",
					title: "Create an account",
					desc: "Sign up for free. No sales call, no credit card. In under a minute.",
				},
				{
					step: "02",
					title: "Invite your team",
					desc: "Invite employees by email or SCIM. Configure departments and locations.",
				},
				{
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
					q: "How quickly can I set up Z8?",
					a: "Most teams are ready in under 5 minutes. Create an account, invite employees by email - done. For enterprise customers with SSO integration, expect 1-2 business days.",
				},
				{
					q: "Is Z8 really GoBD-compliant?",
					a: "Yes. All time entries are stored in an audit-proof way. Later changes are documented and traceable at any time. We work with specialized auditors.",
				},
				{
					q: "Can I connect Z8 to my existing payroll software?",
					a: "Absolutely. We support DATEV, Lexware, Sage, Personio, and SAP out of the box. For other systems, we offer a REST API and Zapier integration.",
				},
				{
					q: "What happens if the internet goes down?",
					a: "The Z8 app works offline. Clock-ins are stored locally and synced automatically as soon as the connection is restored.",
				},
				{
					q: "Is there a minimum contract term?",
					a: "No. All plans can be canceled monthly. No hidden costs, no long-term contracts. You only pay for what you use.",
				},
			],
		},
		newsletterCta: {
			title: "Stay up to date.",
			description: "Product updates, industry insights, and time tracking best practices - straight to your inbox. No spam, unsubscribe anytime.",
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
			description: "Workforce management for modern companies. Time tracking, payroll export, and analytics in one.",
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
