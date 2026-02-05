import Image from "next/image";
import Link from "next/link";

export default function Design8() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Georgia', 'Times New Roman', Times, serif",
				backgroundColor: "#f0ebe1",
				color: "#1a1815",
			}}
		>
			{/* Newsprint texture */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.015]"
				style={{
					backgroundImage:
						"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
					backgroundRepeat: "repeat",
					backgroundSize: "256px 256px",
				}}
			/>

			{/* Masthead */}
			<header className="relative z-10 px-8 pt-8 lg:px-16">
				<div className="flex items-center justify-between pb-3" style={{ borderBottom: "1px solid #1a181530" }}>
					<div className="flex items-center gap-6">
						<span
							className="text-[10px] uppercase tracking-[0.5em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#8a857a",
							}}
						>
							Nr. 01 &mdash; 2025
						</span>
					</div>
					<nav
						className="hidden items-center gap-8 text-[12px] tracking-wide md:flex"
						style={{ color: "#8a857a" }}
					>
						<a href="#features" className="transition-colors hover:text-[#1a1815]">
							Funktionen
						</a>
						<a href="#editorial" className="transition-colors hover:text-[#1a1815]">
							Leitartikel
						</a>
						<a href="#contact" className="transition-colors hover:text-[#1a1815]">
							Kontakt
						</a>
					</nav>
					<a
						href="#contact"
						className="text-[11px] font-bold tracking-wide transition-colors hover:text-[#8b2020]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#1a1815",
						}}
					>
						Demo &rarr;
					</a>
				</div>

				{/* Newspaper title */}
				<div className="py-6 text-center" style={{ borderBottom: "3px double #1a1815" }}>
					<h1
						className="text-[clamp(4rem,10vw,8rem)] font-black uppercase leading-none tracking-[-0.03em]"
						style={{
							fontFamily: "'Impact', 'Arial Black', 'Haettenschweiler', sans-serif",
						}}
					>
						Z8 Anzeiger
					</h1>
					<p className="mt-2 text-[11px] uppercase tracking-[0.6em] text-[#8a857a]">
						Die Zeitung f&uuml;r moderne Arbeitszeitverwaltung &bull; Unabh&auml;ngig &bull; GoBD-konform
					</p>
				</div>
			</header>

			{/* Lead story */}
			<section className="relative z-10 px-8 py-12 lg:px-16">
				<div className="grid gap-8 lg:grid-cols-12" style={{ borderBottom: "1px solid #1a181520" }}>
					{/* Main headline */}
					<div className="pb-8 lg:col-span-7 lg:pr-8" style={{ borderRight: "1px solid #1a181510" }}>
						<span
							className="animate-fade-in mb-4 inline-block bg-[#1a1815] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-[#f0ebe1]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								animationDelay: "0.1s",
							}}
						>
							Aufmacher
						</span>
						<h2
							className="animate-fade-up mb-6 text-[clamp(2rem,5vw,3.8rem)] leading-[1.05] tracking-[-0.02em]"
							style={{
								fontFamily: "'Impact', 'Arial Black', sans-serif",
								animationDelay: "0.2s",
							}}
						>
							ZEITERFASSUNG WIRD ZUR CHEFSACHE: WIE Z8 DIE BRANCHE VER&Auml;NDERT
						</h2>
						<p
							className="animate-fade-up mb-8 text-[16px] leading-[1.85]"
							style={{ color: "#4a4540", animationDelay: "0.3s" }}
						>
							Eine neue Generation von Workforce-Management verspricht nicht nur Compliance,
							sondern echte Benutzerfreundlichkeit. Erstmals vereint eine Plattform
							GoBD-konforme Revisionssicherheit mit einer Oberfl&auml;che, die Teams
							tats&auml;chlich gerne nutzen.
						</p>
						{/* Lead image */}
						<div
							className="animate-scale-in relative h-[35vh] overflow-hidden"
							style={{ animationDelay: "0.4s" }}
						>
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop"
								alt="Modern office"
								fill
								className="object-cover"
								priority
							/>
							<div
								className="absolute inset-0"
								style={{
									background:
										"linear-gradient(180deg, transparent 60%, rgba(240,235,225,0.5) 100%)",
								}}
							/>
							<div className="absolute bottom-3 left-4">
								<span className="text-[9px] uppercase tracking-[0.3em] text-[#1a1815]/60">
									Foto: Moderner Arbeitsplatz mit Z8-Integration
								</span>
							</div>
						</div>
					</div>

					{/* Sidebar stories */}
					<div className="flex flex-col gap-6 pb-8 lg:col-span-5 lg:pl-8">
						<div>
							<span
								className="mb-2 block text-[9px] font-bold uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#8b2020",
								}}
							>
								Compliance
							</span>
							<h3
								className="mb-2 text-xl leading-snug tracking-tight"
								style={{ fontFamily: "'Impact', 'Arial Black', sans-serif" }}
							>
								GOBD-KONFORMIT&Auml;T: WAS UNTERNEHMEN JETZT WISSEN M&Uuml;SSEN
							</h3>
							<p className="text-[13px] leading-[1.7] text-[#6a6560]">
								Revisionssichere Zeiteintr&auml;ge sind keine Option mehr. Z8 macht die
								l&uuml;ckenlose Dokumentation zum Standard.
							</p>
							<div className="mt-3 h-px" style={{ backgroundColor: "#1a181515" }} />
						</div>

						<div>
							<span
								className="mb-2 block text-[9px] font-bold uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#8b2020",
								}}
							>
								Technik
							</span>
							<h3
								className="mb-2 text-xl leading-snug tracking-tight"
								style={{ fontFamily: "'Impact', 'Arial Black', sans-serif" }}
							>
								VON DATEV BIS SAP: LOHNEXPORT OHNE MEDIENBRUCH
							</h3>
							<p className="text-[13px] leading-[1.7] text-[#6a6560]">
								Nahtlose Integration in bestehende Infrastruktur. DATEV, Lexware, Personio
								und weitere &mdash; mit einem Klick.
							</p>
							<div className="mt-3 h-px" style={{ backgroundColor: "#1a181515" }} />
						</div>

						{/* Small image */}
						<div className="relative h-36 overflow-hidden">
							<Image
								src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&q=80&auto=format&fit=crop"
								alt="Team collaboration"
								fill
								className="object-cover grayscale transition-all duration-500 hover:grayscale-0"
							/>
						</div>

						<div>
							<span
								className="mb-2 block text-[9px] font-bold uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#8b2020",
								}}
							>
								Enterprise
							</span>
							<h3
								className="mb-2 text-xl leading-snug tracking-tight"
								style={{ fontFamily: "'Impact', 'Arial Black', sans-serif" }}
							>
								SSO, SCIM UND PASSKEYS: ENTERPRISE-SICHERHEIT NEU GEDACHT
							</h3>
							<p className="text-[13px] leading-[1.7] text-[#6a6560]">
								SAML 2.0, OpenID Connect und automatisierte Benutzerverwaltung f&uuml;r
								Unternehmen jeder Gr&ouml;&szlig;e.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Features - classified ad style grid */}
			<section id="features" className="relative z-10 px-8 pb-20 lg:px-16">
				<div className="mb-10 text-center">
					<span
						className="mb-2 block text-[9px] font-bold uppercase tracking-[0.5em]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#8a857a",
						}}
					>
						Rubrik
					</span>
					<h2
						className="text-3xl tracking-tight"
						style={{ fontFamily: "'Impact', 'Arial Black', sans-serif" }}
					>
						ALLE FUNKTIONEN IM &Uuml;BERBLICK
					</h2>
					<div className="mx-auto mt-4 h-px w-32" style={{ backgroundColor: "#1a181520" }} />
				</div>

				<div
					className="grid gap-0 md:grid-cols-3"
					style={{ border: "1px solid #1a181520" }}
				>
					{[
						{
							title: "Stempeluhr",
							desc: "Web, Desktop, Mobile, Browser-Extension. Echtzeit-Sync.",
						},
						{
							title: "Revisionssicherheit",
							desc: "Unver\u00e4nderbare Eintr\u00e4ge. GoBD-konform. L\u00fcckenlos.",
						},
						{
							title: "Lohn-Schnittstellen",
							desc: "DATEV, Lexware, Personio, SAP. Automatischer Export.",
						},
						{
							title: "Team-\u00dcbersicht",
							desc: "Anwesenheit, \u00dcberstunden, Salden. Sofort einsehbar.",
						},
						{
							title: "Enterprise-SSO",
							desc: "SAML, OIDC, SCIM. Zero-Trust Identity Management.",
						},
						{
							title: "Kalender-Sync",
							desc: "Google Calendar, Microsoft 365. Automatisch abgeglichen.",
						},
					].map((f, i) => (
						<div
							key={i}
							className="group p-6 transition-colors hover:bg-[#1a1815] hover:text-[#f0ebe1]"
							style={{
								borderRight: i % 3 !== 2 ? "1px solid #1a181520" : undefined,
								borderBottom: i < 3 ? "1px solid #1a181520" : undefined,
							}}
						>
							<h3
								className="mb-2 text-[15px] font-bold uppercase tracking-wide"
								style={{ fontFamily: "'Trebuchet MS', sans-serif" }}
							>
								{f.title}
							</h3>
							<p className="text-[12px] leading-[1.7] text-[#8a857a] transition-colors group-hover:text-[#aaa]">
								{f.desc}
							</p>
						</div>
					))}
				</div>
			</section>

			{/* Editorial / Full-width image */}
			<section id="editorial" className="relative z-10">
				<div className="relative h-[45vh] overflow-hidden" style={{ borderTop: "3px double #1a1815", borderBottom: "3px double #1a1815" }}>
					<Image
						src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1920&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover grayscale"
						style={{ objectPosition: "center 50%" }}
					/>
					<div
						className="absolute inset-0"
						style={{
							background:
								"linear-gradient(180deg, rgba(240,235,225,0.3) 0%, rgba(240,235,225,0.8) 100%)",
						}}
					/>
					<div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
						<span
							className="mb-4 text-[9px] font-bold uppercase tracking-[0.5em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#8b2020",
							}}
						>
							Leitartikel
						</span>
						<blockquote
							className="max-w-2xl text-[clamp(1.5rem,3vw,2.5rem)] leading-[1.3] tracking-tight"
							style={{ fontFamily: "'Impact', 'Arial Black', sans-serif" }}
						>
							&bdquo;GUTE ZEITERFASSUNG IST UNSICHTBAR. SIE FUNKTIONIERT EINFACH.&ldquo;
						</blockquote>
						<div className="mx-auto mt-6 h-px w-16" style={{ backgroundColor: "#1a181530" }} />
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-20 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<span
						className="mb-4 block text-[9px] font-bold uppercase tracking-[0.5em]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#8a857a",
						}}
					>
						Anzeige
					</span>
					<h2
						className="mb-4 text-4xl tracking-tight"
						style={{ fontFamily: "'Impact', 'Arial Black', sans-serif" }}
					>
						BEREIT F&Uuml;R DIE N&Auml;CHSTE AUSGABE?
					</h2>
					<p className="mb-10 text-[15px] leading-[1.8] text-[#6a6560]">
						Vereinbaren Sie eine pers&ouml;nliche Demonstration und erleben Sie
						Zeiterfassung, wie sie sein sollte.
					</p>
					<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
						<a
							href="mailto:hello@z8.app"
							className="bg-[#1a1815] px-8 py-3.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#f0ebe1] transition-colors hover:bg-[#8b2020]"
							style={{ fontFamily: "'Trebuchet MS', sans-serif" }}
						>
							Demo vereinbaren
						</a>
						<a
							href="mailto:hello@z8.app"
							className="px-8 py-3.5 text-[11px] tracking-[0.2em] text-[#8a857a] transition-colors hover:text-[#1a1815]"
							style={{ fontFamily: "'Trebuchet MS', sans-serif" }}
						>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer
				className="relative z-10 px-8 py-6 lg:px-16"
				style={{ borderTop: "3px double #1a1815" }}
			>
				<div className="flex items-center justify-between">
					<span className="text-[10px] tracking-[0.3em] text-[#8a857a]">
						&copy; 2025 Z8 Anzeiger
					</span>
					<Link
						href="/"
						className="text-[10px] tracking-[0.3em] text-[#8a857a] transition-colors hover:text-[#1a1815]"
					>
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
