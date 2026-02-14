"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

const themes = {
	dark: {
		bg: "#0a0e1a",
		text: "#c8d0e0",
		heading: "#e0e8f4",
		accent: "#4a6fa5",
		secondary: "#3a4a6a",
		body: "#4a5a7a",
		bodyAlt: "#5a6a8a",
		muted: "#2a3a5a",
		cardBg: "#0a0e1a",
		cardHeading: "#c8d0e0",
		hoverAccent: "#6a8fd0",
		quote: "#6a7a9a",
		feature: "#5a6a8a",
		btnText: "#0a0e1a",
		outlineBorder: "#2a3a5a",
		highlightBg: "#0a0e1a",
		border: "rgba(74,111,165,0.06)",
		gridGap: "rgba(74,111,165,0.08)",
		kanjiGhost: "rgba(74,111,165,0.08)",
		kanjiNum: "rgba(74,111,165,0.3)",
		kanjiWorkflow: "rgba(74,111,165,0.06)",
		badgeBorder: "rgba(74,111,165,0.1)",
		ambient1: "radial-gradient(ellipse 80% 60% at 20% 30%, rgba(30,50,100,0.18) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(20,30,70,0.1) 0%, transparent 50%)",
		inkLine: "linear-gradient(to bottom, transparent, rgba(100,130,200,0.15) 30%, rgba(100,130,200,0.08) 70%, transparent)",
		imgFilter: "saturate(0.1) brightness(0.45) contrast(1.3)",
		imgFilterAlt: "saturate(0.08) brightness(0.4) contrast(1.3)",
		imgFilterSide: "saturate(0.08) brightness(0.45) contrast(1.25)",
		heroOverlay: "linear-gradient(to bottom, rgba(10,14,26,0.3), rgba(10,14,26,0.7)), linear-gradient(to right, rgba(74,111,165,0.08), transparent)",
		wideOverlay: "linear-gradient(to right, rgba(10,14,26,0.85) 0%, rgba(10,14,26,0.4) 50%, rgba(10,14,26,0.85) 100%)",
		imgOverlayL: "linear-gradient(to left, rgba(10,14,26,0.2), rgba(10,14,26,0.6))",
		imgOverlayR: "linear-gradient(to right, rgba(10,14,26,0.2), rgba(10,14,26,0.6))",
		gridImgOverlay: "linear-gradient(to bottom, transparent 50%, rgba(10,14,26,0.7))",
		ctaShadow: "0_0_40px_rgba(74,111,165,0.2)",
		outlineHoverBg: "rgba(74,111,165,0.1)",
	},
	light: {
		bg: "#f6f4f0",
		text: "#3a3d4a",
		heading: "#1a1d2a",
		accent: "#4a6080",
		secondary: "#8a90a8",
		body: "#7a808e",
		bodyAlt: "#7a808e",
		muted: "#b0b4bc",
		cardBg: "#f6f4f0",
		cardHeading: "#2a2d3a",
		hoverAccent: "#4a6080",
		quote: "#6a7080",
		feature: "#6a7080",
		btnText: "#f6f4f0",
		outlineBorder: "#c0c4cc",
		highlightBg: "#efeee9",
		border: "rgba(74,96,128,0.08)",
		gridGap: "rgba(74,96,128,0.08)",
		kanjiGhost: "rgba(74,96,128,0.07)",
		kanjiNum: "rgba(74,96,128,0.2)",
		kanjiWorkflow: "rgba(74,96,128,0.07)",
		badgeBorder: "rgba(74,96,128,0.12)",
		ambient1: "radial-gradient(ellipse 80% 60% at 20% 30%, rgba(180,170,150,0.12) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(160,150,130,0.08) 0%, transparent 50%)",
		inkLine: "linear-gradient(to bottom, transparent, rgba(90,100,120,0.1) 30%, rgba(90,100,120,0.05) 70%, transparent)",
		imgFilter: "saturate(0.15) brightness(1.05) contrast(0.9)",
		imgFilterAlt: "saturate(0.12) brightness(1.1) contrast(0.85)",
		imgFilterSide: "saturate(0.12) brightness(1.08) contrast(0.88)",
		heroOverlay: "linear-gradient(to bottom, rgba(246,244,240,0.2), rgba(246,244,240,0.5)), linear-gradient(to right, rgba(74,96,128,0.04), transparent)",
		wideOverlay: "linear-gradient(to right, rgba(246,244,240,0.8) 0%, rgba(246,244,240,0.3) 50%, rgba(246,244,240,0.8) 100%)",
		imgOverlayL: "linear-gradient(to left, rgba(246,244,240,0.15), rgba(246,244,240,0.5))",
		imgOverlayR: "linear-gradient(to right, rgba(246,244,240,0.15), rgba(246,244,240,0.5))",
		gridImgOverlay: "linear-gradient(to bottom, transparent 50%, rgba(246,244,240,0.6))",
		ctaShadow: "0_0_40px_rgba(74,96,128,0.18)",
		outlineHoverBg: "rgba(74,96,128,0.06)",
	},
} as const;

export default function DesignS1() {
	const [mode, setMode] = useState<"dark" | "light">("dark");
	const t = themes[mode];

	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'Noto Serif JP', 'Playfair Display', 'Cormorant Garamond', Georgia, serif",
				backgroundColor: t.bg,
				color: t.text,
				transition: "background-color 0.6s ease, color 0.6s ease",
			}}
		>
			{/* Ink wash ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{ background: t.ambient1, transition: "background 0.6s ease" }}
			/>

			{/* Ink drip decorative line */}
			<div
				className="pointer-events-none fixed left-[12%] top-0 z-0 h-full w-px"
				style={{ background: t.inkLine, transition: "background 0.6s ease" }}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-8 lg:px-20">
				<div className="flex items-baseline gap-4">
					<span
						className="text-[28px] font-bold tracking-[-0.04em]"
						style={{ color: t.accent, transition: "color 0.6s ease" }}
					>
						Z8
					</span>
					<span
						className="text-[10px] tracking-[0.4em] uppercase"
						style={{ color: t.secondary, transition: "color 0.6s ease" }}
					>
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] tracking-[0.2em] uppercase md:flex" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
					<a href="#features" className="transition-colors" style={{ color: "inherit" }}>Funktionen</a>
					<a href="#workflow" className="transition-colors" style={{ color: "inherit" }}>Workflow</a>
					<a href="#compliance" className="transition-colors" style={{ color: "inherit" }}>Compliance</a>
					<a href="#integrations" className="transition-colors" style={{ color: "inherit" }}>Integrationen</a>
					<a href="#contact" className="transition-colors" style={{ color: "inherit" }}>Kontakt</a>
				</nav>
				<div className="flex items-center gap-4">
					{/* Mode toggle */}
					<button
						onClick={() => setMode(mode === "dark" ? "light" : "dark")}
						className="flex h-8 w-8 items-center justify-center text-[16px] transition-all"
						style={{ color: t.secondary, opacity: 0.7 }}
						aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
					>
						{mode === "dark" ? "明" : "暗"}
					</button>
					<a
						href="#contact"
						className="rounded-none px-6 py-2.5 text-[11px] tracking-[0.15em] uppercase transition-all"
						style={{ border: `1px solid ${t.outlineBorder}`, color: t.hoverAccent, transition: "border-color 0.6s ease, color 0.6s ease" }}
					>
						Starten
					</a>
				</div>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[88vh] flex-col justify-center px-8 lg:px-20">
				<div className="max-w-3xl">
					{/* Kanji-inspired decorative mark */}
					<div
						className="animate-fade-in mb-8 text-[120px] font-thin leading-none"
						style={{ color: t.kanjiGhost, animationDelay: "0s", transition: "color 0.6s ease" }}
					>
						時
					</div>

					<p
						className="animate-fade-up text-[11px] tracking-[0.3em] uppercase"
						style={{ color: t.accent, animationDelay: "0.1s", transition: "color 0.6s ease" }}
					>
						Die Kunst der Zeiterfassung
					</p>

					<h1
						className="animate-fade-up mt-6 text-[clamp(2.5rem,6vw,5rem)] font-light leading-[1.05] tracking-[-0.03em]"
						style={{ color: t.heading, animationDelay: "0.25s", transition: "color 0.6s ease" }}
					>
						Zeit fließt.
						<br />
						<span style={{ color: t.accent, transition: "color 0.6s ease" }}>Fangen Sie</span>
						<br />
						sie ein.
					</h1>

					<p
						className="animate-fade-up mt-8 max-w-md text-[16px] leading-[1.8]"
						style={{ color: t.bodyAlt, animationDelay: "0.4s", transition: "color 0.6s ease" }}
					>
						Wie Tusche auf Papier — jede Sekunde hinterlässt eine Spur.
						Z8 verwandelt flüchtige Momente in bleibende Klarheit.
						Stempeluhr, Berichte, Schichtplanung und Lohnexport — in einem Werkzeug.
					</p>

					<div className="animate-fade-up mt-12 flex items-center gap-6" style={{ animationDelay: "0.55s" }}>
						<a
							href="#contact"
							className={`px-8 py-3.5 text-[12px] tracking-[0.15em] uppercase transition-all hover:shadow-[${t.ctaShadow}]`}
							style={{ backgroundColor: t.accent, color: t.btnText, transition: "background-color 0.6s ease, color 0.6s ease" }}
						>
							Kostenlos testen
						</a>
						<a
							href="#features"
							className="text-[12px] tracking-[0.15em] uppercase transition-colors"
							style={{ color: t.secondary, transition: "color 0.6s ease" }}
						>
							Mehr erfahren →
						</a>
					</div>
				</div>

				{/* Hero image — ink wash treatment */}
				<div
					className="animate-fade-in absolute right-[5%] top-[12%] hidden overflow-hidden lg:block"
					style={{ animationDelay: "0.6s", width: 340, height: 460 }}
				>
					<Image
						src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=700&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: t.imgFilter, transition: "filter 0.6s ease" }}
					/>
					<div className="absolute inset-0" style={{ background: t.heroOverlay, transition: "background 0.6s ease" }} />
				</div>
			</section>

			{/* Logo bar — trusted by */}
			<section className="relative z-10 px-8 py-16 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<p className="text-center text-[10px] tracking-[0.3em] uppercase" style={{ color: t.muted, transition: "color 0.6s ease" }}>
						Vertraut von über 10.000 Unternehmen
					</p>
					<div className="mt-8 flex flex-wrap items-center justify-center gap-12">
						{["Siemens", "Bosch", "SAP", "Allianz", "BASF", "Deutsche Bahn"].map((name) => (
							<span
								key={name}
								className="text-[14px] font-light tracking-[0.1em]"
								style={{ color: t.muted, transition: "color 0.6s ease" }}
							>
								{name}
							</span>
						))}
					</div>
				</div>
			</section>

			{/* Core features — ink card grid */}
			<section id="features" className="relative z-10 px-8 py-32 lg:px-20">
				<div className="mx-auto max-w-5xl">
					<p
						className="text-[11px] tracking-[0.3em] uppercase"
						style={{ color: t.accent, transition: "color 0.6s ease" }}
					>
						Funktionen
					</p>
					<h2
						className="mt-4 text-[clamp(1.8rem,3.5vw,3rem)] font-light leading-[1.15] tracking-[-0.02em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Reduziert auf das Wesentliche
					</h2>

					<div className="mt-16 grid gap-px md:grid-cols-3" style={{ backgroundColor: t.gridGap, transition: "background-color 0.6s ease" }}>
						{[
							{ num: "一", title: "Stempeluhr", desc: "Ein Klick genügt. Start, Stopp, Pause — auf Web, Desktop und Mobilgerät. Echtzeit-Synchronisation über alle Geräte." },
							{ num: "二", title: "Berichte & Analyse", desc: "Echtzeit-Dashboards zeigen Überstunden, Trends und Auslastung. Klare Übersichten, die für sich sprechen." },
							{ num: "三", title: "Schichtplanung", desc: "Schichten erstellen, zuweisen und verwalten. Automatische Konflikterkennung und Benachrichtigungen." },
						].map((f) => (
							<div
								key={f.num}
								className="p-10"
								style={{ backgroundColor: t.cardBg, transition: "background-color 0.6s ease" }}
							>
								<span className="text-[32px] font-thin" style={{ color: t.kanjiNum, transition: "color 0.6s ease" }}>
									{f.num}
								</span>
								<h3 className="mt-4 text-[18px] font-light tracking-[-0.01em]" style={{ color: t.cardHeading, transition: "color 0.6s ease" }}>
									{f.title}
								</h3>
								<p className="mt-3 text-[14px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>

					{/* Second row */}
					<div className="mt-px grid gap-px md:grid-cols-3" style={{ backgroundColor: t.gridGap, transition: "background-color 0.6s ease" }}>
						{[
							{ num: "四", title: "Lohnexport", desc: "Automatischer Export zu DATEV, Lexware und Personio. Fehlerfrei, pünktlich, revisionssicher." },
							{ num: "五", title: "Urlaubsverwaltung", desc: "Urlaubsanträge, Genehmigungen und Resttagekontingente — alles digital, alles transparent." },
							{ num: "六", title: "Überstundenkonto", desc: "Automatische Berechnung, Auf- und Abbau, flexible Regeln pro Mitarbeiter oder Abteilung." },
						].map((f) => (
							<div
								key={f.num}
								className="p-10"
								style={{ backgroundColor: t.cardBg, transition: "background-color 0.6s ease" }}
							>
								<span className="text-[32px] font-thin" style={{ color: t.kanjiNum, transition: "color 0.6s ease" }}>
									{f.num}
								</span>
								<h3 className="mt-4 text-[18px] font-light tracking-[-0.01em]" style={{ color: t.cardHeading, transition: "color 0.6s ease" }}>
									{f.title}
								</h3>
								<p className="mt-3 text-[14px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Workflow — how it works */}
			<section id="workflow" className="relative z-10 px-8 py-32 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
						Workflow
					</p>
					<h2
						className="mt-4 text-[clamp(1.8rem,3.5vw,3rem)] font-light leading-[1.15] tracking-[-0.02em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Drei Pinselstriche genügen
					</h2>

					<div className="mt-20 grid gap-16 md:grid-cols-3">
						{[
							{
								step: "01",
								kanji: "登",
								title: "Registrieren",
								desc: "Konto erstellen in unter 60 Sekunden. Keine Kreditkarte, keine Bindung. Team per E-Mail einladen.",
							},
							{
								step: "02",
								kanji: "記",
								title: "Erfassen",
								desc: "Mitarbeiter stempeln per Klick — am PC, Tablet oder Smartphone. GPS-Stempel für Außendienst optional.",
							},
							{
								step: "03",
								kanji: "析",
								title: "Auswerten",
								desc: "Berichte generieren sich automatisch. Export an den Steuerberater oder direkt ins Lohnsystem.",
							},
						].map((s) => (
							<div key={s.step} className="relative">
								<div
									className="text-[80px] font-thin leading-none"
									style={{ color: t.kanjiWorkflow, transition: "color 0.6s ease" }}
								>
									{s.kanji}
								</div>
								<div className="mt-4 text-[11px] tracking-[0.2em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
									Schritt {s.step}
								</div>
								<h3 className="mt-2 text-[20px] font-light" style={{ color: t.heading, transition: "color 0.6s ease" }}>
									{s.title}
								</h3>
								<p className="mt-3 text-[14px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
									{s.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Hero image — full width with ink treatment */}
			<section className="relative z-10 mx-8 lg:mx-20">
				<div className="relative h-[50vh] min-h-[320px] overflow-hidden">
					<Image
						src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: t.imgFilterAlt, transition: "filter 0.6s ease" }}
					/>
					<div className="absolute inset-0" style={{ background: t.wideOverlay, transition: "background 0.6s ease" }} />
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="text-center px-8">
							<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
								Ihr Dashboard
							</p>
							<h2
								className="mt-4 text-[clamp(1.5rem,3vw,2.5rem)] font-light leading-[1.2] tracking-[-0.02em]"
								style={{ color: t.heading, transition: "color 0.6s ease" }}
							>
								Alles auf einen Blick — wer arbeitet,
								<br />
								wer pausiert, wer im Urlaub ist.
							</h2>
						</div>
					</div>
				</div>
			</section>

			{/* Multi-tenant & Enterprise */}
			<section className="relative z-10 px-8 py-32 lg:px-20">
				<div className="mx-auto max-w-5xl">
					<div className="grid items-center gap-16 lg:grid-cols-2">
						<div>
							<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
								Enterprise
							</p>
							<h2
								className="mt-4 text-[clamp(1.8rem,3.5vw,2.8rem)] font-light leading-[1.15] tracking-[-0.02em]"
								style={{ color: t.heading, transition: "color 0.6s ease" }}
							>
								Skaliert mit
								<br />
								Ihrem Unternehmen
							</h2>
							<p className="mt-6 text-[15px] leading-[1.8]" style={{ color: t.body, transition: "color 0.6s ease" }}>
								Von 2 bis 20.000 Mitarbeiter — Z8 wächst mit Ihnen. Mandantenfähig,
								mit isolierten Organisationen und rollenbasierter Zugriffskontrolle.
							</p>

							<div className="mt-10 space-y-6">
								{[
									{ title: "Mandantenfähig", desc: "Mehrere Organisationen unter einem Dach, strikt getrennt." },
									{ title: "Enterprise-SSO", desc: "SAML, OIDC und SCIM für nahtlose IT-Integration." },
									{ title: "Rollenbasierte Rechte", desc: "Admin, Manager, Mitarbeiter — granular steuerbar." },
								].map((item) => (
									<div key={item.title} className="flex items-start gap-4">
										<div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.accent, transition: "background-color 0.6s ease" }} />
										<div>
											<h4 className="text-[15px] font-light" style={{ color: t.cardHeading, transition: "color 0.6s ease" }}>
												{item.title}
											</h4>
											<p className="mt-1 text-[13px] leading-[1.6]" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
												{item.desc}
											</p>
										</div>
									</div>
								))}
							</div>
						</div>

						{/* Right — image */}
						<div className="relative h-[400px] overflow-hidden hidden lg:block">
							<Image
								src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: t.imgFilter, transition: "filter 0.6s ease" }}
							/>
							<div className="absolute inset-0" style={{ background: t.imgOverlayL, transition: "background 0.6s ease" }} />
						</div>
					</div>
				</div>
			</section>

			{/* Compliance & Security */}
			<section id="compliance" className="relative z-10 px-8 py-32 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<div className="grid items-center gap-16 lg:grid-cols-2">
						{/* Left — image */}
						<div className="relative h-[380px] overflow-hidden hidden lg:block">
							<Image
								src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: t.imgFilterSide, transition: "filter 0.6s ease" }}
							/>
							<div className="absolute inset-0" style={{ background: t.imgOverlayR, transition: "background 0.6s ease" }} />
						</div>

						<div>
							<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
								Compliance
							</p>
							<h2
								className="mt-4 text-[clamp(1.8rem,3.5vw,2.8rem)] font-light leading-[1.15] tracking-[-0.02em]"
								style={{ color: t.heading, transition: "color 0.6s ease" }}
							>
								Revisionssicher.
								<br />
								<span style={{ color: t.accent, transition: "color 0.6s ease" }}>Rechtssicher.</span>
							</h2>
							<p className="mt-6 text-[15px] leading-[1.8]" style={{ color: t.body, transition: "color 0.6s ease" }}>
								Jeder Eintrag ist unveränderbar protokolliert. Z8 erfüllt alle
								Anforderungen an die digitale Arbeitszeiterfassung nach deutschem Recht.
							</p>

							<div className="mt-10 grid grid-cols-2 gap-6">
								{[
									{ label: "GoBD", desc: "Konform" },
									{ label: "DSGVO", desc: "Zertifiziert" },
									{ label: "AES-256", desc: "Verschlüsselung" },
									{ label: "ISO 27001", desc: "Hosting" },
								].map((badge) => (
									<div key={badge.label} className="p-5" style={{ border: `1px solid ${t.badgeBorder}`, transition: "border-color 0.6s ease" }}>
										<div className="text-[18px] font-light" style={{ color: t.accent, transition: "color 0.6s ease" }}>
											{badge.label}
										</div>
										<div className="mt-1 text-[12px] tracking-[0.1em] uppercase" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
											{badge.desc}
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Integrations */}
			<section id="integrations" className="relative z-10 px-8 py-32 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
						Integrationen
					</p>
					<h2
						className="mt-4 text-[clamp(1.8rem,3.5vw,3rem)] font-light leading-[1.15] tracking-[-0.02em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Verbindet sich nahtlos
					</h2>
					<p className="mt-4 max-w-lg text-[15px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
						Z8 fügt sich in Ihren bestehenden Workflow ein — nicht umgekehrt.
						Automatische Datenübernahme, kein manuelles Abtippen.
					</p>

					<div className="mt-16 grid gap-px md:grid-cols-4" style={{ backgroundColor: t.border, transition: "background-color 0.6s ease" }}>
						{[
							{ name: "DATEV", desc: "Lohndaten automatisch übertragen" },
							{ name: "Lexware", desc: "Nahtloser Buchhaltungs-Export" },
							{ name: "Personio", desc: "HR-Daten synchronisieren" },
							{ name: "SAP", desc: "Enterprise-Integration via API" },
							{ name: "Slack", desc: "Stempel-Benachrichtigungen" },
							{ name: "Google", desc: "Kalender-Synchronisation" },
							{ name: "MS Teams", desc: "Stempeln direkt im Chat" },
							{ name: "REST API", desc: "Eigene Integrationen bauen" },
						].map((i) => (
							<div key={i.name} className="p-6" style={{ backgroundColor: t.cardBg, transition: "background-color 0.6s ease" }}>
								<div className="text-[15px] font-light" style={{ color: t.cardHeading, transition: "color 0.6s ease" }}>
									{i.name}
								</div>
								<p className="mt-1 text-[12px] leading-[1.5]" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
									{i.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Device showcase */}
			<section className="relative z-10 px-8 py-24 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<div className="text-center">
						<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
							Plattformen
						</p>
						<h2
							className="mt-4 text-[clamp(1.8rem,3.5vw,2.8rem)] font-light leading-[1.15] tracking-[-0.02em]"
							style={{ color: t.heading, transition: "color 0.6s ease" }}
						>
							Überall. Jederzeit.
						</h2>
						<p className="mx-auto mt-4 max-w-md text-[15px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
							Web-App, native Desktop-App für Windows und Mac,
							mobile Apps für iOS und Android. Alles synchron, alles in Echtzeit.
						</p>
					</div>

					<div className="mt-16 grid gap-4 md:grid-cols-3">
						{[
							"https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&q=80&auto=format&fit=crop",
							"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
							"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
						].map((src, idx) => (
							<div key={idx} className="relative h-56 overflow-hidden">
								<Image src={src} alt="" fill className="object-cover" style={{ filter: t.imgFilter, transition: "filter 0.6s ease" }} />
								<div className="absolute inset-0" style={{ background: t.gridImgOverlay, transition: "background 0.6s ease" }} />
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Stats */}
			<section className="relative z-10 px-8 py-24 lg:px-20" style={{ borderTop: `1px solid ${t.gridGap}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto flex max-w-5xl items-center justify-between">
					{[
						{ value: "10k+", label: "Aktive Nutzer" },
						{ value: "99.9%", label: "Verfügbarkeit" },
						{ value: "<1s", label: "Erfassungszeit" },
						{ value: "4.9★", label: "Bewertung" },
					].map((s) => (
						<div key={s.label} className="text-center">
							<div className="text-[clamp(1.5rem,3vw,2.5rem)] font-light tracking-[-0.03em]" style={{ color: t.accent, transition: "color 0.6s ease" }}>
								{s.value}
							</div>
							<div className="mt-2 text-[11px] tracking-[0.15em] uppercase" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
								{s.label}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Testimonials */}
			<section className="relative z-10 px-8 py-32 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<p className="text-center text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
						Stimmen
					</p>
					<h2
						className="mt-4 text-center text-[clamp(1.8rem,3.5vw,2.8rem)] font-light leading-[1.15] tracking-[-0.02em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Was unsere Kunden sagen
					</h2>

					<div className="mt-16 grid gap-px md:grid-cols-2" style={{ backgroundColor: t.border, transition: "background-color 0.6s ease" }}>
						{[
							{
								quote: "Z8 hat unsere Lohnbuchhaltung um 4 Stunden pro Woche entlastet. Der DATEV-Export funktioniert einwandfrei.",
								name: "Thomas K.",
								role: "Geschäftsführer, 85 Mitarbeiter",
							},
							{
								quote: "Endlich eine Zeiterfassung, die unsere Außendienstler genauso einfach nutzen wie das Büro-Team.",
								name: "Sarah M.",
								role: "HR-Leiterin, 220 Mitarbeiter",
							},
							{
								quote: "Die Schichtplanung allein hat sich sofort bezahlt gemacht. Keine Excel-Dateien mehr, keine Konflikte.",
								name: "Michael W.",
								role: "Produktionsleiter, 140 Mitarbeiter",
							},
							{
								quote: "Revisionssicher, DSGVO-konform und die Mitarbeiter lieben die App. Was will man mehr?",
								name: "Anna L.",
								role: "Steuerberaterin",
							},
						].map((testimonial) => (
							<div key={testimonial.name} className="p-10" style={{ backgroundColor: t.cardBg, transition: "background-color 0.6s ease" }}>
								<p className="text-[15px] italic leading-[1.7]" style={{ color: t.quote, transition: "color 0.6s ease" }}>
									&ldquo;{testimonial.quote}&rdquo;
								</p>
								<div className="mt-6">
									<div className="text-[14px] font-light" style={{ color: t.cardHeading, transition: "color 0.6s ease" }}>
										{testimonial.name}
									</div>
									<div className="mt-1 text-[12px]" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
										{testimonial.role}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Pricing preview */}
			<section className="relative z-10 px-8 py-32 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-4xl text-center">
					<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
						Preise
					</p>
					<h2
						className="mt-4 text-[clamp(1.8rem,3.5vw,2.8rem)] font-light leading-[1.15] tracking-[-0.02em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Einfach. Transparent.
					</h2>
					<p className="mx-auto mt-4 max-w-md text-[15px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
						Keine versteckten Kosten. Jederzeit kündbar.
					</p>

					<div className="mt-16 grid gap-px md:grid-cols-3" style={{ backgroundColor: t.gridGap, transition: "background-color 0.6s ease" }}>
						{[
							{
								plan: "Starter",
								price: "0 €",
								per: "für immer",
								features: ["Bis 5 Mitarbeiter", "Stempeluhr", "Basis-Berichte", "Mobile App"],
							},
							{
								plan: "Business",
								price: "4,90 €",
								per: "pro Nutzer / Monat",
								features: ["Unbegrenzte Mitarbeiter", "Schichtplanung", "Lohnexport", "DATEV & Lexware", "Überstundenkonto", "Prioritäts-Support"],
								highlighted: true,
							},
							{
								plan: "Enterprise",
								price: "Individuell",
								per: "auf Anfrage",
								features: ["Alles aus Business", "SSO (SAML/OIDC)", "Mandantenfähigkeit", "Dedizierter Ansprechpartner", "SLA 99.99%", "On-Premise Option"],
							},
						].map((p) => (
							<div
								key={p.plan}
								className="flex flex-col p-10 text-left"
								style={{
									backgroundColor: p.highlighted ? t.highlightBg : t.cardBg,
									borderTop: p.highlighted ? `2px solid ${t.accent}` : "none",
									transition: "background-color 0.6s ease, border-color 0.6s ease",
								}}
							>
								<div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
									{p.plan}
								</div>
								<div className="mt-4 text-[clamp(1.5rem,2.5vw,2rem)] font-light" style={{ color: t.heading, transition: "color 0.6s ease" }}>
									{p.price}
								</div>
								<div className="mt-1 text-[12px]" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
									{p.per}
								</div>
								<div className="mt-6 flex-1 space-y-3">
									{p.features.map((f) => (
										<div key={f} className="flex items-center gap-3 text-[13px]" style={{ color: t.feature, transition: "color 0.6s ease" }}>
											<div className="h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: t.accent, transition: "background-color 0.6s ease" }} />
											{f}
										</div>
									))}
								</div>
								<a
									href="#contact"
									className="mt-8 block py-3 text-center text-[11px] tracking-[0.15em] uppercase transition-all"
									style={{
										backgroundColor: p.highlighted ? t.accent : "transparent",
										color: p.highlighted ? t.btnText : t.accent,
										border: p.highlighted ? "none" : `1px solid ${t.badgeBorder}`,
										transition: "background-color 0.6s ease, color 0.6s ease, border-color 0.6s ease",
									}}
								>
									{p.plan === "Enterprise" ? "Kontaktieren" : "Starten"}
								</a>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* FAQ */}
			<section className="relative z-10 px-8 py-32 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-3xl">
					<p className="text-[11px] tracking-[0.3em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
						Häufige Fragen
					</p>
					<h2
						className="mt-4 text-[clamp(1.8rem,3.5vw,2.8rem)] font-light leading-[1.15] tracking-[-0.02em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Antworten
					</h2>

					<div className="mt-12 space-y-0">
						{[
							{
								q: "Ist Z8 wirklich kostenlos?",
								a: "Ja. Der Starter-Plan für bis zu 5 Mitarbeiter ist dauerhaft kostenlos — ohne Kreditkarte, ohne Ablaufdatum.",
							},
							{
								q: "Wie funktioniert der DATEV-Export?",
								a: "Z8 generiert automatisch eine DATEV-konforme Exportdatei. Ein Klick, und die Daten sind bei Ihrem Steuerberater.",
							},
							{
								q: "Wo werden meine Daten gespeichert?",
								a: "Ausschließlich auf deutschen Servern, AES-256 verschlüsselt, ISO 27001 zertifiziert. Ihre Daten verlassen nie die EU.",
							},
							{
								q: "Kann ich Z8 mit meiner bestehenden Software verbinden?",
								a: "Ja. Neben den fertigen Integrationen (DATEV, Lexware, Personio, SAP) bieten wir eine vollständige REST-API.",
							},
							{
								q: "Erfüllt Z8 die gesetzlichen Anforderungen?",
								a: "Vollständig. GoBD-konform, revisionssicher, DSGVO-zertifiziert. Jeder Eintrag ist unveränderbar protokolliert.",
							},
						].map((faq) => (
							<div
								key={faq.q}
								className="py-8"
								style={{ borderBottom: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}
							>
								<h4 className="text-[16px] font-light" style={{ color: t.cardHeading, transition: "color 0.6s ease" }}>
									{faq.q}
								</h4>
								<p className="mt-3 text-[14px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
									{faq.a}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA */}
			<section
				id="contact"
				className="relative z-10 px-8 py-32 lg:px-20"
				style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}
			>
				<div className="mx-auto max-w-3xl text-center">
					{/* Decorative kanji */}
					<div
						className="mx-auto mb-6 text-[80px] font-thin leading-none"
						style={{ color: t.kanjiGhost, transition: "color 0.6s ease" }}
					>
						始
					</div>
					<h2
						className="text-[clamp(2rem,4vw,3.5rem)] font-light leading-[1.1] tracking-[-0.03em]"
						style={{ color: t.heading, transition: "color 0.6s ease" }}
					>
						Bereit für <span style={{ color: t.accent, transition: "color 0.6s ease" }}>Klarheit</span>?
					</h2>
					<p className="mt-6 max-w-md mx-auto text-[15px] leading-[1.7]" style={{ color: t.body, transition: "color 0.6s ease" }}>
						Starten Sie heute mit Z8 und erleben Sie Zeiterfassung, die sich wie Intuition anfühlt.
						Kostenlos, unverbindlich, in unter einer Minute eingerichtet.
					</p>
					<div className="mt-10 flex items-center justify-center gap-6">
						<a
							href="#"
							className={`px-10 py-4 text-[12px] tracking-[0.15em] uppercase transition-all hover:shadow-[${t.ctaShadow}]`}
							style={{ backgroundColor: t.accent, color: t.btnText, transition: "background-color 0.6s ease, color 0.6s ease" }}
						>
							Jetzt kostenlos starten
						</a>
						<a
							href="#"
							className="px-10 py-4 text-[12px] tracking-[0.15em] uppercase transition-all"
							style={{ border: `1px solid ${t.badgeBorder}`, color: t.hoverAccent, transition: "border-color 0.6s ease, color 0.6s ease" }}
						>
							Demo anfragen
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-12 lg:px-20" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
				<div className="mx-auto max-w-5xl">
					<div className="grid gap-12 md:grid-cols-4">
						<div>
							<span className="text-[18px] font-bold tracking-[-0.03em]" style={{ color: t.accent, transition: "color 0.6s ease" }}>
								Z8
							</span>
							<p className="mt-3 text-[13px] leading-[1.6]" style={{ color: t.secondary, transition: "color 0.6s ease" }}>
								Die Kunst der
								<br />
								Zeiterfassung.
							</p>
						</div>
						{[
							{
								title: "Produkt",
								links: ["Stempeluhr", "Schichtplanung", "Berichte", "Lohnexport", "API"],
							},
							{
								title: "Unternehmen",
								links: ["Über uns", "Karriere", "Blog", "Presse"],
							},
							{
								title: "Rechtliches",
								links: ["Datenschutz", "AGB", "Impressum", "Cookie-Einstellungen"],
							},
						].map((col) => (
							<div key={col.title}>
								<div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: t.accent, transition: "color 0.6s ease" }}>
									{col.title}
								</div>
								<div className="mt-4 space-y-2.5">
									{col.links.map((link) => (
										<a
											key={link}
											href="#"
											className="block text-[13px] transition-colors"
											style={{ color: t.secondary }}
										>
											{link}
										</a>
									))}
								</div>
							</div>
						))}
					</div>
					<div className="mt-12 flex items-center justify-between pt-8" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.6s ease" }}>
						<span className="text-[11px]" style={{ color: t.muted, transition: "color 0.6s ease" }}>
							© 2025 Z8 — Made in Frankfurt am Main
						</span>
						<Link href="/" className="text-[11px] transition-colors" style={{ color: t.secondary }}>
							← Alle Designs
						</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}
