import Image from "next/image";
import Link from "next/link";

export default function Design15() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Courier New', 'Lucida Console', monospace",
				backgroundColor: "#f0f4f8",
				color: "#1e3a5f",
			}}
		>
			{/* Blueprint grid */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]"
				style={{
					backgroundImage:
						"linear-gradient(#1e3a5f 1px, transparent 1px), linear-gradient(90deg, #1e3a5f 1px, transparent 1px)",
					backgroundSize: "40px 40px",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-5 lg:px-12" style={{ borderBottom: "2px solid #1e3a5f20" }}>
				<div className="flex items-center gap-4">
					<div className="flex h-10 w-10 items-center justify-center rounded-none text-[11px] font-bold text-white" style={{ backgroundColor: "#1e3a5f" }}>
						Z8
					</div>
					<div>
						<span className="block text-[12px] font-bold uppercase tracking-[0.15em]">Z8 System</span>
						<span className="block text-[8px] uppercase tracking-[0.3em] text-[#1e3a5f]/40">Rev. 8.0 | Blueprint</span>
					</div>
				</div>
				<nav className="hidden items-center gap-8 text-[10px] uppercase tracking-[0.2em] text-[#1e3a5f]/50 md:flex">
					<a href="#features" className="transition-colors hover:text-[#1e3a5f]">[Spezifikation]</a>
					<a href="#schema" className="transition-colors hover:text-[#1e3a5f]">[Schema]</a>
					<a href="#contact" className="transition-colors hover:text-[#1e3a5f]">[Anfrage]</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors hover:bg-[#1e3a5f] hover:text-white"
					style={{ border: "1.5px solid #1e3a5f" }}
				>
					Anfragen
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-8 pb-16 pt-20 lg:px-12">
				<div className="mb-4 flex items-center gap-3">
					<span className="text-[9px] uppercase tracking-[0.4em] text-[#1e3a5f]/30">Projekt: Zeiterfassung</span>
					<div className="h-px flex-1" style={{ backgroundColor: "#1e3a5f15" }} />
					<span className="text-[9px] uppercase tracking-[0.4em] text-[#1e3a5f]/30">Ma&szlig;stab 1:1</span>
				</div>

				<h1
					className="animate-fade-up text-[clamp(3rem,9vw,7.5rem)] font-bold uppercase leading-[0.9] tracking-[-0.03em]"
					style={{ animationDelay: "0.2s" }}
				>
					<span className="block">Pr&auml;zisions-</span>
					<span className="block" style={{ color: "#1e3a5f60" }}>Zeiterfassung</span>
				</h1>

				<div className="mt-12 grid gap-8 md:grid-cols-2">
					<p className="animate-fade-up text-[13px] leading-[1.9] text-[#1e3a5f]/60" style={{ animationDelay: "0.4s" }}>
						Technische Dokumentation. GoBD-konform. Revisionssicher.
						Ingenieurm&auml;&szlig;ig gebaut f&uuml;r Unternehmen, die Pr&auml;zision
						zur Grundlage machen.
					</p>
					<div className="animate-fade-up flex items-end justify-end gap-4" style={{ animationDelay: "0.5s" }}>
						<a href="#contact" className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white" style={{ backgroundColor: "#1e3a5f" }}>
							Projekt starten
						</a>
						<a href="#features" className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ border: "1.5px solid #1e3a5f" }}>
							Spezifikation &darr;
						</a>
					</div>
				</div>
			</section>

			{/* Technical drawing image */}
			<section className="relative z-10 mx-8 mb-20 lg:mx-12">
				<div className="relative h-[40vh] overflow-hidden" style={{ border: "1.5px solid #1e3a5f20" }}>
					<Image
						src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80&auto=format&fit=crop"
						alt="Technical workspace"
						fill
						className="object-cover"
						style={{ filter: "saturate(0.3) brightness(1.1) contrast(0.9)", objectPosition: "center 40%" }}
						priority
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(30,58,95,0.05) 0%, rgba(30,58,95,0.15) 100%)" }} />
					{/* Corner marks */}
					<div className="absolute left-3 top-3 h-6 w-6" style={{ borderLeft: "1.5px solid #1e3a5f40", borderTop: "1.5px solid #1e3a5f40" }} />
					<div className="absolute right-3 top-3 h-6 w-6" style={{ borderRight: "1.5px solid #1e3a5f40", borderTop: "1.5px solid #1e3a5f40" }} />
					<div className="absolute bottom-3 left-3 h-6 w-6" style={{ borderLeft: "1.5px solid #1e3a5f40", borderBottom: "1.5px solid #1e3a5f40" }} />
					<div className="absolute bottom-3 right-3 h-6 w-6" style={{ borderRight: "1.5px solid #1e3a5f40", borderBottom: "1.5px solid #1e3a5f40" }} />
					<div className="absolute bottom-3 left-3">
						<span className="text-[8px] uppercase tracking-[0.3em] text-[#1e3a5f]/40">Abb. 1.0 &mdash; Systemumgebung</span>
					</div>
				</div>
			</section>

			{/* Features / Specification */}
			<section id="features" className="relative z-10 px-8 pb-24 lg:px-12">
				<div className="mb-12 flex items-center gap-3">
					<span className="text-[9px] uppercase tracking-[0.4em] text-[#1e3a5f]/30">Spezifikation</span>
					<div className="h-px flex-1" style={{ backgroundColor: "#1e3a5f15" }} />
				</div>

				<div className="grid gap-[1.5px] md:grid-cols-2 lg:grid-cols-3" style={{ backgroundColor: "#1e3a5f15" }}>
					{[
						{ id: "SP-01", title: "Stempeluhr", desc: "Multi-Plattform Echtzeit-Synchronisation." },
						{ id: "SP-02", title: "GoBD-Konformit\u00e4t", desc: "WORM-Speicher. Digitale Signatur." },
						{ id: "SP-03", title: "Lohnexport", desc: "DATEV/Lexware/Personio/SAP Interface." },
						{ id: "SP-04", title: "Multi-Tenant", desc: "Isolierte Mandantenarchitektur." },
						{ id: "SP-05", title: "SSO & SCIM", desc: "SAML 2.0, OIDC, Auto-Provisioning." },
						{ id: "SP-06", title: "Analyse", desc: "Echtzeit-Dashboard & Reporting." },
					].map((f) => (
						<div key={f.id} className="group bg-[#f0f4f8] p-6 transition-colors hover:bg-[#1e3a5f] hover:text-white">
							<span className="mb-3 block text-[9px] font-bold tracking-[0.3em] text-[#1e3a5f]/30 transition-colors group-hover:text-white/30">
								{f.id}
							</span>
							<h3 className="mb-2 text-[14px] font-bold uppercase tracking-wide">{f.title}</h3>
							<p className="text-[11px] leading-[1.7] text-[#1e3a5f]/50 transition-colors group-hover:text-white/60">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Schema */}
			<section id="schema" className="relative z-10 px-8 pb-24 lg:px-12">
				<div className="mb-12 flex items-center gap-3">
					<span className="text-[9px] uppercase tracking-[0.4em] text-[#1e3a5f]/30">Technische Daten</span>
					<div className="h-px flex-1" style={{ backgroundColor: "#1e3a5f15" }} />
				</div>
				<div className="grid gap-4 md:grid-cols-4">
					{[
						{ l: "Framework", v: "Next.js 16" }, { l: "Datenbank", v: "PostgreSQL" },
						{ l: "Cache", v: "Valkey/Redis" }, { l: "Auth", v: "Better Auth" },
						{ l: "ORM", v: "Drizzle" }, { l: "Queue", v: "BullMQ" },
						{ l: "Storage", v: "S3-compat" }, { l: "Monitoring", v: "OTEL" },
					].map((s) => (
						<div key={s.l} className="p-3" style={{ border: "1.5px solid #1e3a5f15" }}>
							<span className="block text-[8px] uppercase tracking-[0.3em] text-[#1e3a5f]/30">{s.l}</span>
							<span className="text-[12px] font-bold">{s.v}</span>
						</div>
					))}
				</div>
			</section>

			{/* Full-width image */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-12">
				<div className="relative h-48 overflow-hidden" style={{ border: "1.5px solid #1e3a5f20" }}>
					<Image src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.2) brightness(1.1)" }} />
					<div className="absolute inset-0 flex items-center justify-center">
						<span className="text-[9px] uppercase tracking-[0.5em] text-[#1e3a5f]/40">Infrastruktur-Schema</span>
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-12">
				<div className="mx-auto max-w-xl text-center">
					<span className="mb-4 block text-[9px] uppercase tracking-[0.4em] text-[#1e3a5f]/30">Projektanfrage</span>
					<h2 className="mb-4 text-3xl font-bold uppercase tracking-tight">Projekt starten?</h2>
					<p className="mb-10 text-[13px] leading-relaxed text-[#1e3a5f]/50">
						Wir konfigurieren Z8 nach Ihren technischen Anforderungen.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block px-8 py-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white"
						style={{ backgroundColor: "#1e3a5f" }}
					>
						Anfrage senden
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-6 lg:px-12" style={{ borderTop: "2px solid #1e3a5f20" }}>
				<div className="flex items-center justify-between text-[9px] uppercase tracking-[0.3em] text-[#1e3a5f]/30">
					<span>&copy; 2025 Z8 | Blueprint Rev. 8.0</span>
					<Link href="/" className="transition-colors hover:text-[#1e3a5f]">&larr; Index</Link>
				</div>
			</footer>
		</div>
	);
}
