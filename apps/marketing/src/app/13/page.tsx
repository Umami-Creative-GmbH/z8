import Image from "next/image";
import Link from "next/link";

export default function Design13() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Calibri', 'Gill Sans', 'Trebuchet MS', sans-serif",
				backgroundColor: "#f8fafb",
				color: "#1e293b",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-center gap-2.5">
					<div
						className="flex h-9 w-9 items-center justify-center rounded-md text-[11px] font-bold text-white"
						style={{ backgroundColor: "#475569" }}
					>
						Z8
					</div>
					<span className="text-[13px] font-semibold text-[#94a3b8]">Z8</span>
				</div>
				<nav className="hidden items-center gap-10 text-[13px] font-medium text-[#94a3b8] md:flex">
					<a href="#features" className="transition-colors hover:text-[#1e293b]">Funktionen</a>
					<a href="#about" className="transition-colors hover:text-[#1e293b]">Philosophie</a>
					<a href="#contact" className="transition-colors hover:text-[#1e293b]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="rounded-md px-5 py-2.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
					style={{ backgroundColor: "#3b82f6" }}
				>
					Demo starten
				</a>
			</header>

			{/* Hero - clean Scandinavian */}
			<section className="relative z-10 px-8 pb-20 pt-24 lg:px-16">
				<div className="mx-auto max-w-3xl text-center">
					<p
						className="animate-fade-up mb-6 text-[12px] font-semibold uppercase tracking-[0.3em] text-[#3b82f6]"
						style={{ animationDelay: "0.1s" }}
					>
						Enkel &bull; Tydelig &bull; Sikker
					</p>
					<h1
						className="animate-fade-up text-[clamp(2.8rem,6vw,5rem)] font-bold leading-[1.08] tracking-[-0.03em]"
						style={{ animationDelay: "0.2s" }}
					>
						Zeiterfassung,
						<br />
						klar und ruhig.
					</h1>
					<p
						className="animate-fade-up mx-auto mt-6 max-w-lg text-[15px] leading-[1.8] text-[#64748b]"
						style={{ animationDelay: "0.35s" }}
					>
						Z8 vereint GoBD-konforme Pr&auml;zision mit nordischer Klarheit. Gebaut f&uuml;r Teams,
						die Funktionalit&auml;t &uuml;ber Dekoration stellen.
					</p>
					<div
						className="animate-fade-up mt-10 flex flex-wrap justify-center gap-3"
						style={{ animationDelay: "0.5s" }}
					>
						<a
							href="#contact"
							className="rounded-md px-7 py-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
							style={{ backgroundColor: "#3b82f6" }}
						>
							Kostenlos testen
						</a>
						<a
							href="#features"
							className="rounded-md px-7 py-3.5 text-[13px] font-semibold text-[#64748b] transition-colors hover:text-[#1e293b]"
							style={{ border: "1.5px solid #e2e8f0" }}
						>
							Mehr erfahren
						</a>
					</div>
				</div>
			</section>

			{/* Image - clean, light */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="animate-scale-in relative h-[45vh] overflow-hidden rounded-xl" style={{ animationDelay: "0.6s" }}>
					<Image
						src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80&auto=format&fit=crop"
						alt="Clean workspace"
						fill
						className="object-cover"
						style={{ objectPosition: "center 40%" }}
						priority
					/>
					<div
						className="absolute inset-0 rounded-xl"
						style={{ background: "linear-gradient(180deg, rgba(248,250,251,0) 60%, rgba(248,250,251,0.3) 100%)" }}
					/>
				</div>
			</section>

			{/* Features - clean cards */}
			<section id="features" className="relative z-10 px-8 pb-24 lg:px-16">
				<div className="mb-14 text-center">
					<h2 className="text-2xl font-bold tracking-tight">Alles Wesentliche.</h2>
					<p className="mt-2 text-[14px] text-[#94a3b8]">Keine &uuml;berfl&uuml;ssigen Features. Nur das, was z&auml;hlt.</p>
				</div>

				<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Ein Klick. Alle Ger\u00e4te. Immer synchron." },
						{ title: "GoBD-konform", desc: "Revisionssicher. Unver\u00e4nderbar. Gepr\u00fcft." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio. Automatisch." },
						{ title: "Team-\u00dcbersicht", desc: "Anwesenheit und Salden. Klar strukturiert." },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Sicher integriert." },
						{ title: "Dashboards", desc: "\u00dcberstunden, Trends. Sofort sichtbar." },
					].map((f, i) => (
						<div
							key={i}
							className="group rounded-xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-md"
							style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0" }}
						>
							<h3 className="mb-2 text-[15px] font-bold tracking-tight">{f.title}</h3>
							<p className="text-[13px] leading-[1.7] text-[#94a3b8]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Image pair */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
					<div className="relative h-64 overflow-hidden rounded-xl">
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" />
					</div>
					<div className="relative h-64 overflow-hidden rounded-xl">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" />
					</div>
				</div>
			</section>

			{/* About */}
			<section id="about" className="relative z-10 px-8 py-20 lg:px-16" style={{ backgroundColor: "#f1f5f9" }}>
				<div className="mx-auto max-w-xl text-center">
					<h2 className="mb-4 text-2xl font-bold tracking-tight">Reduziert auf das Wesentliche.</h2>
					<p className="text-[15px] leading-[1.8] text-[#64748b]">
						Gute Software tritt in den Hintergrund. Sie funktioniert einfach &mdash; ohne
						Ablenkung, ohne Umwege. Das ist der nordische Ansatz.
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-md text-center">
					<h2 className="mb-4 text-2xl font-bold tracking-tight">Bereit f&uuml;r Klarheit?</h2>
					<p className="mb-8 text-[14px] leading-relaxed text-[#94a3b8]">
						Testen Sie Z8 kostenlos. Kein Risiko, keine Verpflichtung.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block rounded-md px-8 py-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
						style={{ backgroundColor: "#3b82f6" }}
					>
						Demo vereinbaren
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-6 lg:px-16" style={{ borderTop: "1px solid #e2e8f0" }}>
				<div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#3b82f6]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
