import Image from "next/image";
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
				{/* Hero background image */}
				<div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
					<Image
						src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1920&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover opacity-[0.07]"
						style={{ objectPosition: "center 30%" }}
						priority
					/>
					<div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent" />
				</div>

				<div className="relative z-10">
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
							Modulare Arbeitszeitverwaltung mit revisionssicherer Dokumentation. Entwickelt
							f&uuml;r Teams, die Pr&auml;zision und Klarheit sch&auml;tzen.
						</p>
					</div>
				</div>
			</section>

			{/* Visual break - architectural image strip */}
			<section className="relative z-10 border-y border-white/10">
				<div className="grid md:grid-cols-3">
					<div className="relative h-48 overflow-hidden">
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=640&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover opacity-40 grayscale transition-all duration-700 hover:opacity-60 hover:grayscale-0"
						/>
					</div>
					<div className="relative h-48 overflow-hidden">
						<Image
							src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=640&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover opacity-40 grayscale transition-all duration-700 hover:opacity-60 hover:grayscale-0"
						/>
					</div>
					<div className="relative h-48 overflow-hidden">
						<Image
							src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=640&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover opacity-40 grayscale transition-all duration-700 hover:opacity-60 hover:grayscale-0"
						/>
					</div>
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

			{/* Full-width atmospheric image */}
			<section className="relative z-10 h-[40vh] overflow-hidden border-y border-white/10">
				<Image
					src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80&auto=format&fit=crop"
					alt=""
					fill
					className="object-cover opacity-30 grayscale"
				/>
				<div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-transparent to-[#0a0a0a]" />
				<div className="absolute inset-0 flex items-center justify-center">
					<p className="text-[10px] font-bold uppercase tracking-[0.5em] text-white/20">
						Pr&auml;zision in jedem Detail
					</p>
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
