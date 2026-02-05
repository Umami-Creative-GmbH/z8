import Link from "next/link";

export default function Design1() {
	return (
		<div
			className="min-h-screen bg-[#0a0a0a] text-[#e8e8e8]"
			style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
		>
			{/* Grid overlay */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]"
				style={{
					backgroundImage:
						"linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
					backgroundSize: "80px 80px",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between border-b border-white/10 px-8 py-6">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center border border-white/20 text-sm font-black tracking-tighter">
						Z8
					</div>
					<span className="text-[10px] font-medium uppercase tracking-[0.3em] text-white/40">
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-xs font-medium uppercase tracking-[0.2em] text-white/50 md:flex">
					<a href="#features" className="transition-colors hover:text-white">
						Funktionen
					</a>
					<a href="#about" className="transition-colors hover:text-white">
						System
					</a>
					<a href="#contact" className="transition-colors hover:text-white">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="border border-white/20 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.25em] transition-colors hover:bg-white hover:text-black"
				>
					Demo anfragen
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[85vh] flex-col justify-end px-8 pb-20 pt-32">
				<div className="mb-8 flex items-end gap-8">
					<p
						className="animate-fade-up text-[11px] font-medium uppercase tracking-[0.4em] text-white/30"
						style={{ animationDelay: "0.1s" }}
					>
						Workforce
						<br />
						Management
						<br />
						Platform
					</p>
					<div className="h-px flex-1 bg-white/10" />
					<p
						className="animate-fade-up text-right text-[11px] font-medium uppercase tracking-[0.4em] text-white/30"
						style={{ animationDelay: "0.2s" }}
					>
						GoBD-
						<br />
						Konform
					</p>
				</div>

				<h1 className="animate-fade-up" style={{ animationDelay: "0.3s" }}>
					<span className="block text-[clamp(3rem,12vw,10rem)] font-black uppercase leading-[0.85] tracking-[-0.04em]">
						Zeiterfassung
					</span>
					<span className="block text-[clamp(3rem,12vw,10rem)] font-black uppercase leading-[0.85] tracking-[-0.04em] text-white/20">
						Neu Gedacht
					</span>
				</h1>

				<div
					className="mt-12 flex items-center gap-6 animate-fade-up"
					style={{ animationDelay: "0.5s" }}
				>
					<div className="h-[1px] w-16 bg-white/30" />
					<p className="max-w-md text-sm leading-relaxed text-white/50">
						Modulare Arbeitszeitverwaltung mit revisionssicherer Dokumentation. Entwickelt f&uuml;r
						Teams, die Pr&auml;zision und Klarheit sch&auml;tzen.
					</p>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 border-t border-white/10 px-8 py-32">
				<div className="mb-20 flex items-start justify-between">
					<span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/30">
						01 / Funktionen
					</span>
					<h2 className="max-w-lg text-right text-3xl font-light leading-snug tracking-tight">
						Jeder Aspekt Ihrer Arbeitszeiterfassung &mdash; <em>systematisch gel&ouml;st</em>
					</h2>
				</div>

				<div className="grid gap-[1px] bg-white/10 md:grid-cols-3">
					{[
						{
							num: "01",
							title: "Stempeluhr",
							desc: "Ein-/Ausstempeln per Web, Desktop, Mobile oder Browser-Extension. Echtzeit-Synchronisation.",
						},
						{
							num: "02",
							title: "GoBD-Konformit\u00e4t",
							desc: "Revisionssichere, unver\u00e4nderbare Zeiteintr\u00e4ge. L\u00fcckenlose Nachvollziehbarkeit.",
						},
						{
							num: "03",
							title: "Lohnexport",
							desc: "DATEV, Lexware, Personio, SAP \u2014 nahtlose Integration in Ihre bestehende Infrastruktur.",
						},
						{
							num: "04",
							title: "Multi-Tenant",
							desc: "Mandantenf\u00e4hige Architektur. Jede Organisation isoliert und sicher verwaltet.",
						},
						{
							num: "05",
							title: "SSO & SCIM",
							desc: "Enterprise-Authentifizierung mit SAML, OIDC und automatisierter Benutzerverwaltung.",
						},
						{
							num: "06",
							title: "Echtzeit-Analyse",
							desc: "\u00dcberstunden, Fehlzeiten, Teamauslastung \u2014 in Dashboards sofort sichtbar.",
						},
					].map((f) => (
						<div key={f.num} className="group bg-[#0a0a0a] p-8 transition-colors hover:bg-[#111]">
							<span className="mb-6 block text-[10px] font-bold tracking-[0.3em] text-white/20">
								{f.num}
							</span>
							<h3 className="mb-3 text-lg font-bold tracking-tight">{f.title}</h3>
							<p className="text-sm leading-relaxed text-white/40">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 border-t border-white/10 px-8 py-32">
				<div className="mx-auto max-w-2xl text-center">
					<span className="mb-6 block text-[10px] font-bold uppercase tracking-[0.4em] text-white/30">
						02 / Kontakt
					</span>
					<h2 className="mb-6 text-4xl font-black uppercase tracking-tight">
						Bereit f&uuml;r Struktur?
					</h2>
					<p className="mb-12 text-sm leading-relaxed text-white/40">
						Lassen Sie uns sprechen. Wir zeigen Ihnen, wie Z8 Ihre Zeiterfassung transformiert.
					</p>
					<div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
						<a
							href="mailto:hello@z8.app"
							className="inline-block border border-white px-8 py-4 text-[11px] font-bold uppercase tracking-[0.3em] transition-colors hover:bg-white hover:text-black"
						>
							Demo vereinbaren
						</a>
						<a
							href="mailto:hello@z8.app"
							className="inline-block px-8 py-4 text-[11px] font-bold uppercase tracking-[0.3em] text-white/40 transition-colors hover:text-white"
						>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 border-t border-white/10 px-8 py-8">
				<div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-white/20">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-white/60">
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
