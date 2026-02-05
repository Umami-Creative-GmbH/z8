import Image from "next/image";
import Link from "next/link";

export default function Design16() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Segoe UI', 'SF Pro Display', system-ui, sans-serif",
				backgroundColor: "#0f172a",
				color: "#e2e8f0",
			}}
		>
			{/* Background gradient mesh */}
			<div className="pointer-events-none fixed inset-0 z-0">
				<div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse at 20% 50%, #1e40af20 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, #7c3aed15 0%, transparent 50%)" }} />
			</div>

			{/* Header - frosted */}
			<header
				className="relative z-10 mx-4 mt-4 flex items-center justify-between rounded-2xl px-6 py-4 lg:mx-8"
				style={{
					backgroundColor: "rgba(30, 41, 59, 0.6)",
					backdropFilter: "blur(20px)",
					border: "1px solid rgba(148, 163, 184, 0.1)",
				}}
			>
				<div className="flex items-center gap-2.5">
					<div
						className="flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold text-white"
						style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
					>
						Z8
					</div>
					<span className="text-[13px] font-semibold text-[#94a3b8]">Z8</span>
				</div>
				<nav className="hidden items-center gap-8 text-[12px] text-[#64748b] md:flex">
					<a href="#features" className="transition-colors hover:text-white">Funktionen</a>
					<a href="#about" className="transition-colors hover:text-white">Info</a>
					<a href="#contact" className="transition-colors hover:text-white">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="rounded-xl px-5 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
					style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
				>
					Starten
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-6 pb-20 pt-28 text-center lg:px-12">
				<div
					className="animate-scale-in mx-auto mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] text-[#94a3b8]"
					style={{
						backgroundColor: "rgba(30, 41, 59, 0.6)",
						backdropFilter: "blur(12px)",
						border: "1px solid rgba(148, 163, 184, 0.1)",
						animationDelay: "0.1s",
					}}
				>
					<span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />
					Jetzt verf&uuml;gbar
				</div>

				<h1
					className="animate-fade-up mx-auto max-w-3xl text-[clamp(2.8rem,7vw,5rem)] font-bold leading-[1.05] tracking-[-0.03em] text-white"
					style={{ animationDelay: "0.2s" }}
				>
					Zeiterfassung durch die
					<br />
					<span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)" }}>
						Glaslinse
					</span>
				</h1>

				<p
					className="animate-fade-up mx-auto mt-6 max-w-lg text-[15px] leading-[1.8] text-[#64748b]"
					style={{ animationDelay: "0.35s" }}
				>
					Transparent, klar und GoBD-konform. Z8 verbindet moderne &Auml;sthetik mit
					revisionssicherer Pr&auml;zision.
				</p>

				<div className="animate-fade-up mt-10 flex flex-wrap justify-center gap-3" style={{ animationDelay: "0.5s" }}>
					<a
						href="#contact"
						className="rounded-xl px-7 py-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-80"
						style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
					>
						Kostenlos testen
					</a>
					<a
						href="#features"
						className="rounded-xl px-7 py-3.5 text-[13px] font-semibold text-[#94a3b8] transition-colors hover:text-white"
						style={{
							backgroundColor: "rgba(30, 41, 59, 0.6)",
							backdropFilter: "blur(12px)",
							border: "1px solid rgba(148, 163, 184, 0.1)",
						}}
					>
						Mehr erfahren
					</a>
				</div>

				{/* Glass dashboard mockup */}
				<div
					className="animate-scale-in relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-2xl"
					style={{
						backgroundColor: "rgba(30, 41, 59, 0.4)",
						backdropFilter: "blur(20px)",
						border: "1px solid rgba(148, 163, 184, 0.1)",
						animationDelay: "0.6s",
					}}
				>
					<div className="relative h-[40vh]">
						<Image
							src="https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=1200&q=80&auto=format&fit=crop"
							alt="Dashboard"
							fill
							className="object-cover opacity-60"
							style={{ filter: "brightness(0.7)" }}
						/>
						<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(15,23,42,0.8) 100%)" }} />
					</div>
				</div>
			</section>

			{/* Features - glass cards */}
			<section id="features" className="relative z-10 px-6 py-24 lg:px-12">
				<div className="mb-14 text-center">
					<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#3b82f6]">Funktionen</p>
					<h2 className="text-2xl font-bold tracking-tight text-white">Alles im Blick.</h2>
				</div>

				<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Ein Klick. Alle Ger\u00e4te. Sofort synchron." },
						{ title: "GoBD-konform", desc: "Revisionssicher. Unver\u00e4nderbar. Gepr\u00fcft." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio. Automatisch." },
						{ title: "Teams", desc: "Rollen, Abteilungen, Berechtigungen. Flexibel." },
						{ title: "SSO", desc: "SAML, OIDC, SCIM. Enterprise-ready." },
						{ title: "Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Live." },
					].map((f, i) => (
						<div
							key={i}
							className="group rounded-xl p-6 transition-all hover:-translate-y-0.5"
							style={{
								backgroundColor: "rgba(30, 41, 59, 0.5)",
								backdropFilter: "blur(16px)",
								border: "1px solid rgba(148, 163, 184, 0.08)",
							}}
						>
							<h3 className="mb-2 text-[14px] font-semibold text-white">{f.title}</h3>
							<p className="text-[12px] leading-[1.7] text-[#64748b]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Image strip */}
			<section className="relative z-10 mx-6 mb-24 lg:mx-12">
				<div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1497366216548-37526070297c?w=500&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=500&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-48 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(148, 163, 184, 0.08)" }}>
							<Image src={src} alt="" fill className="object-cover opacity-50" />
						</div>
					))}
				</div>
			</section>

			{/* About */}
			<section id="about" className="relative z-10 px-6 py-20 lg:px-12">
				<div
					className="mx-auto max-w-2xl rounded-2xl p-12 text-center"
					style={{
						backgroundColor: "rgba(30, 41, 59, 0.4)",
						backdropFilter: "blur(20px)",
						border: "1px solid rgba(148, 163, 184, 0.08)",
					}}
				>
					<h2 className="mb-4 text-2xl font-bold tracking-tight text-white">Klarheit durch Transparenz.</h2>
					<p className="text-[14px] leading-[1.8] text-[#64748b]">
						Wie Glas &mdash; man sieht hindurch auf das, was wirklich z&auml;hlt. Z8 entfernt
						alles, was im Weg steht, und zeigt nur das Wesentliche.
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-6 py-24 text-center lg:px-12">
				<h2 className="mb-4 text-3xl font-bold tracking-tight text-white">Bereit f&uuml;r Klarheit?</h2>
				<p className="mb-8 text-[14px] text-[#64748b]">Starten Sie kostenlos. Kein Risiko.</p>
				<a
					href="mailto:hello@z8.app"
					className="inline-block rounded-xl px-8 py-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-80"
					style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
				>
					Demo vereinbaren
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-6 py-6 lg:px-12" style={{ borderTop: "1px solid rgba(148, 163, 184, 0.08)" }}>
				<div className="flex items-center justify-between text-[11px] text-[#334155]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#3b82f6]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
