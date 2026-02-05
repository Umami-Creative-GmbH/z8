import Image from "next/image";
import Link from "next/link";

export default function Design7() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Lucida Sans', 'Lucida Sans Regular', 'Lucida Grande', 'Trebuchet MS', sans-serif",
				backgroundColor: "#f5f2ed",
				color: "#1a1a1a",
			}}
		>
			{/* Visible grid lines */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.06]"
				style={{
					backgroundImage:
						"linear-gradient(#1a1a1a 1px, transparent 1px), linear-gradient(90deg, #1a1a1a 1px, transparent 1px)",
					backgroundSize: "120px 120px",
				}}
			/>

			{/* Header */}
			<header
				className="relative z-10 flex items-center justify-between px-8 py-6 lg:px-16"
				style={{ borderBottom: "2px solid #1a1a1a" }}
			>
				<div className="flex items-center gap-4">
					<div
						className="flex h-10 w-10 items-center justify-center text-[13px] font-black text-white"
						style={{ backgroundColor: "#d42b2b" }}
					>
						Z8
					</div>
					<div>
						<span className="block text-[13px] font-bold uppercase tracking-[0.15em]">
							Z8 Zeiterfassung
						</span>
						<span className="block text-[9px] uppercase tracking-[0.4em] text-[#999]">
							Workforce Management System
						</span>
					</div>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] font-bold uppercase tracking-[0.2em] md:flex">
					<a href="#features" className="text-[#999] transition-colors hover:text-[#d42b2b]">
						Funktionen
					</a>
					<a href="#system" className="text-[#999] transition-colors hover:text-[#d42b2b]">
						System
					</a>
					<a href="#contact" className="text-[#999] transition-colors hover:text-[#d42b2b]">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-opacity hover:opacity-90"
					style={{ backgroundColor: "#d42b2b" }}
				>
					Demo anfragen
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-8 pb-16 pt-20 lg:px-16">
				<div className="grid lg:grid-cols-12">
					<div className="lg:col-span-8">
						{/* Section label */}
						<div
							className="animate-fade-up mb-12 flex items-center gap-4"
							style={{ animationDelay: "0.1s" }}
						>
							<span
								className="flex h-8 w-8 items-center justify-center text-[10px] font-black text-white"
								style={{ backgroundColor: "#d42b2b" }}
							>
								01
							</span>
							<span className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#999]">
								Startseite
							</span>
							<div className="h-px flex-1 bg-[#1a1a1a]/10" />
						</div>

						<h1
							className="animate-fade-up text-[clamp(3.2rem,9vw,8rem)] font-black uppercase leading-[0.88] tracking-[-0.04em]"
							style={{ animationDelay: "0.2s" }}
						>
							Zeit-
							<br />
							erfassung
						</h1>
						<h2
							className="animate-fade-up mt-2 text-[clamp(3.2rem,9vw,8rem)] font-black uppercase leading-[0.88] tracking-[-0.04em]"
							style={{ color: "#d42b2b", animationDelay: "0.3s" }}
						>
							Neu
							<br />
							Definiert.
						</h2>
					</div>

					<div
						className="animate-fade-up mt-12 flex flex-col justify-end lg:col-span-3 lg:col-start-10 lg:mt-0"
						style={{ animationDelay: "0.5s" }}
					>
						<p className="text-[14px] leading-[1.8] text-[#666]">
							Modulare, GoBD-konforme Arbeitszeitverwaltung. Gebaut mit Schweizer
							Pr&auml;zision f&uuml;r Teams, die Klarheit sch&auml;tzen.
						</p>
						<div className="mt-8 flex gap-3">
							<a
								href="#contact"
								className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white"
								style={{ backgroundColor: "#d42b2b" }}
							>
								Starten
							</a>
							<a
								href="#features"
								className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em]"
								style={{ border: "2px solid #1a1a1a" }}
							>
								Mehr &rarr;
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Hero image strip */}
			<section className="relative z-10" style={{ borderTop: "2px solid #1a1a1a" }}>
				<div className="grid md:grid-cols-12">
					<div className="relative h-64 overflow-hidden md:col-span-5">
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
					</div>
					<div
						className="flex items-center justify-center px-8 py-8 md:col-span-3"
						style={{ backgroundColor: "#d42b2b" }}
					>
						<div className="text-center text-white">
							<span className="block text-5xl font-black">99.9%</span>
							<span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">
								Uptime
							</span>
						</div>
					</div>
					<div className="relative h-64 overflow-hidden md:col-span-4">
						<Image
							src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=600&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
					</div>
				</div>
			</section>

			{/* Features grid */}
			<section
				id="features"
				className="relative z-10 px-8 py-28 lg:px-16"
				style={{ borderTop: "2px solid #1a1a1a" }}
			>
				<div className="mb-20 flex items-center gap-4">
					<span
						className="flex h-8 w-8 items-center justify-center text-[10px] font-black text-white"
						style={{ backgroundColor: "#d42b2b" }}
					>
						02
					</span>
					<span className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#999]">
						Funktionen
					</span>
					<div className="h-px flex-1 bg-[#1a1a1a]/10" />
					<h2 className="text-3xl font-black uppercase tracking-tight">
						Systematisch gel&ouml;st.
					</h2>
				</div>

				<div className="grid gap-0 border-2 border-[#1a1a1a] md:grid-cols-3">
					{[
						{
							num: "01",
							title: "Stempeluhr",
							desc: "Ein-/Ausstempeln per Web, Desktop, Mobile oder Browser-Extension.",
						},
						{
							num: "02",
							title: "GoBD-Konform",
							desc: "Revisionssichere, unver\u00e4nderbare Zeiteintr\u00e4ge mit L\u00fcckenprotokoll.",
						},
						{
							num: "03",
							title: "Lohnexport",
							desc: "DATEV, Lexware, Personio, SAP \u2014 nahtlose Integration.",
						},
						{
							num: "04",
							title: "Multi-Tenant",
							desc: "Mandantenf\u00e4hig. Jede Organisation isoliert und sicher.",
						},
						{
							num: "05",
							title: "SSO & SCIM",
							desc: "SAML, OIDC, automatisierte Benutzerverwaltung.",
						},
						{
							num: "06",
							title: "Echtzeit-Analyse",
							desc: "\u00dcberstunden, Fehlzeiten, Auslastung \u2014 live in Dashboards.",
						},
					].map((f, i) => (
						<div
							key={f.num}
							className="group p-8 transition-colors hover:bg-[#1a1a1a] hover:text-[#f5f2ed]"
							style={{
								borderRight: i % 3 !== 2 ? "2px solid #1a1a1a" : undefined,
								borderBottom: i < 3 ? "2px solid #1a1a1a" : undefined,
							}}
						>
							<span
								className="mb-5 block text-[10px] font-black tracking-[0.3em] transition-colors group-hover:text-[#d42b2b]"
								style={{ color: "#d42b2b" }}
							>
								{f.num}
							</span>
							<h3 className="mb-3 text-lg font-black uppercase tracking-tight">{f.title}</h3>
							<p className="text-[13px] leading-[1.7] text-[#888] transition-colors group-hover:text-[#999]">
								{f.desc}
							</p>
						</div>
					))}
				</div>
			</section>

			{/* System - large image with overlapping text */}
			<section id="system" className="relative z-10 mx-8 mb-28 lg:mx-16">
				<div className="relative">
					<div className="relative h-[50vh] overflow-hidden">
						<Image
							src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1600&q=80&auto=format&fit=crop"
							alt="Team working"
							fill
							className="object-cover"
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, transparent 30%, rgba(26,26,26,0.7) 100%)",
							}}
						/>
					</div>
					{/* Overlapping content block */}
					<div
						className="-mt-20 relative z-10 mx-auto max-w-2xl p-10 text-center"
						style={{ backgroundColor: "#f5f2ed", border: "2px solid #1a1a1a" }}
					>
						<span
							className="mb-4 block text-[10px] font-black uppercase tracking-[0.4em]"
							style={{ color: "#d42b2b" }}
						>
							Philosophie
						</span>
						<p className="text-[clamp(1.2rem,2.5vw,1.8rem)] font-bold leading-[1.4] tracking-tight">
							Pr&auml;zision ist kein Zufall. Sie ist das Ergebnis von Sorgfalt, Struktur
							und dem Willen, es richtig zu machen.
						</p>
					</div>
				</div>
			</section>

			{/* Contact */}
			<section
				id="contact"
				className="relative z-10 px-8 py-28 lg:px-16"
				style={{ borderTop: "2px solid #1a1a1a" }}
			>
				<div className="mb-12 flex items-center gap-4">
					<span
						className="flex h-8 w-8 items-center justify-center text-[10px] font-black text-white"
						style={{ backgroundColor: "#d42b2b" }}
					>
						03
					</span>
					<span className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#999]">
						Kontakt
					</span>
					<div className="h-px flex-1 bg-[#1a1a1a]/10" />
				</div>

				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<h2 className="mb-6 text-4xl font-black uppercase tracking-tight">
							Bereit f&uuml;r Struktur?
						</h2>
						<p className="max-w-md text-[14px] leading-[1.8] text-[#666]">
							Lassen Sie uns sprechen. In einer pers&ouml;nlichen Demo zeigen wir Ihnen, wie Z8
							Ihre Arbeitszeiterfassung transformiert.
						</p>
					</div>
					<div className="flex items-end justify-start lg:justify-end">
						<div className="flex gap-4">
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-white transition-opacity hover:opacity-90"
								style={{ backgroundColor: "#d42b2b" }}
							>
								Demo vereinbaren
							</a>
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#999] transition-colors hover:text-[#1a1a1a]"
							>
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer
				className="relative z-10 px-8 py-6 lg:px-16"
				style={{ borderTop: "2px solid #1a1a1a" }}
			>
				<div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.3em] text-[#999]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#d42b2b]">
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
