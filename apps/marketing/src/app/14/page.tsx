import Image from "next/image";
import Link from "next/link";

export default function Design14() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Constantia', 'Palatino', 'Georgia', serif",
				backgroundColor: "#faf5ef",
				color: "#3b2f24",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-baseline gap-3">
					<span className="text-2xl font-bold" style={{ color: "#c2703e" }}>Z8</span>
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#b5a08a]">Zeitwirtschaft</span>
				</div>
				<nav className="hidden items-center gap-10 text-[13px] text-[#b5a08a] md:flex">
					<a href="#features" className="transition-colors hover:text-[#3b2f24]">Funktionen</a>
					<a href="#about" className="transition-colors hover:text-[#3b2f24]">Philosophie</a>
					<a href="#contact" className="transition-colors hover:text-[#3b2f24]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="rounded-sm px-6 py-2.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
					style={{ backgroundColor: "#c2703e" }}
				>
					Demo anfragen
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-8 pb-16 pt-20 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<p
							className="animate-fade-up mb-6 text-[11px] font-semibold uppercase tracking-[0.5em]"
							style={{ color: "#c2703e", animationDelay: "0.1s" }}
						>
							Geerdet &bull; Zuverl&auml;ssig
						</p>
						<h1
							className="animate-fade-up text-[clamp(3rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em]"
							style={{ animationDelay: "0.2s" }}
						>
							Zeiterfassung
							<br />
							<span style={{ color: "#c2703e" }}>verwurzelt</span>
							<br />
							in Substanz.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[15px] leading-[1.85] text-[#8a7a6a]"
							style={{ animationDelay: "0.4s" }}
						>
							Wie guter Boden braucht gute Software ein solides Fundament. Z8 ist
							GoBD-konforme Zeiterfassung, die natürlich funktioniert.
						</p>
					</div>

					{/* Hero image */}
					<div className="animate-scale-in relative" style={{ animationDelay: "0.3s" }}>
						<div className="relative h-[55vh] overflow-hidden rounded-sm">
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1000&q=80&auto=format&fit=crop"
								alt="Warm workspace"
								fill
								className="object-cover"
								style={{ filter: "saturate(0.85) sepia(0.1)" }}
								priority
							/>
						</div>
						{/* Terracotta accent bar */}
						<div
							className="absolute -bottom-2 -left-2 h-full w-2 rounded-sm"
							style={{ backgroundColor: "#c2703e" }}
						/>
					</div>
				</div>
			</section>

			{/* Earth-tone strip */}
			<section className="relative z-10 flex h-2">
				<div className="flex-1" style={{ backgroundColor: "#c2703e" }} />
				<div className="flex-1" style={{ backgroundColor: "#a0845c" }} />
				<div className="flex-1" style={{ backgroundColor: "#8a7a6a" }} />
				<div className="flex-1" style={{ backgroundColor: "#d4b896" }} />
				<div className="flex-1" style={{ backgroundColor: "#e8d5be" }} />
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-28 lg:px-16">
				<div className="mb-16">
					<span className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.5em] text-[#c2703e]">
						Funktionen
					</span>
					<h2 className="text-3xl tracking-tight">Nat&uuml;rlich durchdacht.</h2>
				</div>

				<div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Ein Klick, sofort synchron \u00fcber alle Ger\u00e4te." },
						{ title: "Revisionssicherheit", desc: "Jeder Eintrag unver\u00e4nderbar. GoBD-konforme Archivierung inklusive." },
						{ title: "Lohn-Schnittstellen", desc: "DATEV, Lexware, Personio, SAP. Nahtloser Export." },
						{ title: "Team-\u00dcbersicht", desc: "Anwesenheit, \u00dcberstunden, Salden. Klar und \u00fcbersichtlich." },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Sichere Integration." },
						{ title: "Kalender-Sync", desc: "Google Calendar, Microsoft 365. Automatisch." },
					].map((f, i) => (
						<div key={i} className="group">
							<div
								className="mb-4 h-1 w-6 rounded-full transition-all duration-500 group-hover:w-12"
								style={{ backgroundColor: "#c2703e" }}
							/>
							<h3 className="mb-2 text-lg tracking-tight">{f.title}</h3>
							<p className="text-[13px] leading-[1.85] text-[#8a7a6a]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="grid gap-4 md:grid-cols-3">
					<div className="relative h-64 overflow-hidden rounded-sm">
						<Image src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.8) sepia(0.15)" }} />
					</div>
					<div className="relative h-64 overflow-hidden rounded-sm">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.8) sepia(0.15)" }} />
					</div>
					<div className="relative h-64 overflow-hidden rounded-sm">
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.8) sepia(0.15)" }} />
					</div>
				</div>
			</section>

			{/* About */}
			<section id="about" className="relative z-10 overflow-hidden px-8 py-24 lg:px-16" style={{ backgroundColor: "#3b2f24", color: "#faf5ef" }}>
				<div className="absolute inset-0 opacity-[0.06]">
					<Image src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80&auto=format&fit=crop" alt="" fill className="object-cover" />
				</div>
				<div className="relative z-10 mx-auto max-w-2xl text-center">
					<span className="mb-6 block text-5xl leading-none" style={{ color: "#c2703e" }}>&ldquo;</span>
					<blockquote className="text-[clamp(1.4rem,3vw,2.2rem)] leading-[1.4] tracking-tight">
						Wirklich gute Werkzeuge f&uuml;hlen sich an wie eine nat&uuml;rliche
						Erweiterung der eigenen Arbeit.
					</blockquote>
					<div className="mx-auto mt-8 h-1 w-12 rounded-full" style={{ backgroundColor: "#c2703e" }} />
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-28 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<h2 className="mb-6 text-4xl tracking-tight">
							Lassen Sie uns <span style={{ color: "#c2703e" }}>wachsen</span>.
						</h2>
						<p className="max-w-md text-[15px] leading-[1.85] text-[#8a7a6a]">
							In einer pers&ouml;nlichen Demo zeigen wir Ihnen, wie Z8 Ihr Team unterst&uuml;tzt.
						</p>
					</div>
					<div className="flex items-end justify-start lg:justify-end">
						<div className="flex gap-4">
							<a
								href="mailto:hello@z8.app"
								className="rounded-sm px-8 py-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
								style={{ backgroundColor: "#c2703e" }}
							>
								Demo vereinbaren
							</a>
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-4 text-[12px] text-[#b5a08a] transition-colors hover:text-[#3b2f24]"
							>
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #e8d5be" }}>
				<div className="flex items-center justify-between text-[11px] text-[#b5a08a]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#c2703e]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
