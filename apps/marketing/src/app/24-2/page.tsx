import Image from "next/image";
import Link from "next/link";

export default function Design24_2() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Suisse Intl', 'Aktiv Grotesk', 'Helvetica Neue', sans-serif",
				backgroundColor: "#fafafa",
				color: "#0a0a0a",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-4">
					<span className="text-[24px] font-bold tracking-[-0.03em]">Z8</span>
					<div className="h-4 w-px bg-[#0a0a0a10]" />
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#0a0a0a30]">
						Spiegel
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] tracking-[0.1em] text-[#0a0a0a40] md:flex">
					<a href="#features" className="transition-colors hover:text-[#0a0a0a]">Funktionen</a>
					<a href="#mirror" className="transition-colors hover:text-[#0a0a0a]">Spiegel</a>
					<a href="#contact" className="transition-colors hover:text-[#0a0a0a]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white transition-all hover:bg-[#2a2a2a]"
					style={{ backgroundColor: "#0a0a0a" }}
				>
					Anfragen
				</a>
			</header>

			{/* Mirror line */}
			<div className="relative z-10 mx-8 lg:mx-16">
				<div className="h-px" style={{ background: "linear-gradient(90deg, #0a0a0a, #0a0a0a20)" }} />
			</div>

			{/* Hero — centered mirror concept */}
			<section className="relative z-10 px-8 pt-32 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="text-center">
						<p
							className="animate-fade-up mb-10 text-[10px] font-medium uppercase tracking-[0.7em]"
							style={{ color: "#0a0a0a30", animationDelay: "0.1s" }}
						>
							Perfekte Reflexion
						</p>

						{/* Main text */}
						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(4rem, 12vw, 10rem)",
								fontWeight: 800,
								lineHeight: 0.9,
								letterSpacing: "-0.05em",
								animationDelay: "0.2s",
							}}
						>
							Spiegel.
						</h1>

						{/* Reflected text */}
						<div
							className="animate-fade-in"
							style={{
								fontSize: "clamp(4rem, 12vw, 10rem)",
								fontWeight: 800,
								lineHeight: 0.9,
								letterSpacing: "-0.05em",
								color: "#0a0a0a",
								opacity: 0.04,
								transform: "scaleY(-1)",
								marginTop: "-0.1em",
								animationDelay: "0.6s",
							}}
						>
							Spiegel.
						</div>
					</div>

					{/* Mirror axis line */}
					<div className="mx-auto my-12 flex items-center justify-center gap-4">
						<div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, #0a0a0a15, #0a0a0a30, #0a0a0a15, transparent)" }} />
					</div>

					<div
						className="animate-fade-up mx-auto max-w-lg text-center text-[15px] leading-[2] text-[#0a0a0a50]"
						style={{ animationDelay: "0.4s" }}
					>
						Ihre Prozesse, klar reflektiert. Z8 spiegelt jeden Arbeitsschritt
						in Echtzeit &mdash; GoBD-konform, transparent, symmetrisch pr&auml;zise.
					</div>

					<div className="animate-fade-up mt-12 flex items-center justify-center gap-6" style={{ animationDelay: "0.5s" }}>
						<a
							href="#contact"
							className="px-10 py-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-white transition-all hover:bg-[#2a2a2a]"
							style={{ backgroundColor: "#0a0a0a" }}
						>
							Demo anfragen
						</a>
						<a href="#features" className="text-[11px] tracking-[0.15em] text-[#0a0a0a30] transition-colors hover:text-[#0a0a0a]">
							Erkunden &darr;
						</a>
					</div>
				</div>
			</section>

			{/* Split mirror image */}
			<section className="relative z-10 mx-8 mb-32 mt-24 lg:mx-16">
				<div className="animate-scale-in mx-auto grid max-w-5xl gap-[2px] md:grid-cols-2" style={{ animationDelay: "0.6s" }}>
					<div className="relative h-[35vh] overflow-hidden">
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover"
							style={{ filter: "grayscale(1) brightness(0.95) contrast(1.1)" }}
							priority
						/>
					</div>
					<div className="relative h-[35vh] overflow-hidden">
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover"
							style={{ filter: "grayscale(1) brightness(0.95) contrast(1.1)", transform: "scaleX(-1)" }}
						/>
					</div>
				</div>
				{/* Mirror axis */}
				<div className="mx-auto mt-1 max-w-5xl">
					<div className="mx-auto h-px w-px bg-[#0a0a0a30]" />
				</div>
			</section>

			{/* Features — mirrored two-column layout */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="mb-16 text-center">
						<span className="mb-4 block text-[10px] uppercase tracking-[0.5em] text-[#0a0a0a25]">
							Funktionen
						</span>
						<h2 className="text-4xl font-bold tracking-[-0.03em]">
							Sechs Spiegelungen.
						</h2>
					</div>

					<div className="grid gap-px md:grid-cols-2" style={{ backgroundColor: "#0a0a0a08" }}>
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation \u00fcber alle Ger\u00e4te." },
							{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. Unver\u00e4nderbar dokumentiert." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtloser Transfer." },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Organisationen isoliert und geh\u00e4rtet." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Verschmolzen mit Ihrer Infrastruktur." },
							{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Sofort reflektiert." },
						].map((f, i) => (
							<div
								key={i}
								className="group bg-[#fafafa] p-8 transition-colors hover:bg-[#f5f5f5]"
							>
								<div className="flex items-start justify-between">
									<div>
										<h3 className="mb-2 text-[17px] font-bold tracking-tight">
											{f.title}
										</h3>
										<p className="text-[12px] leading-[1.85] text-[#0a0a0a40]">{f.desc}</p>
									</div>
									<span className="text-[9px] tracking-[0.3em] text-[#0a0a0a15]">
										0{i + 1}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image pair */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="mx-auto grid max-w-5xl gap-px md:grid-cols-2" style={{ backgroundColor: "#0a0a0a08" }}>
					<div className="relative h-52 overflow-hidden bg-[#fafafa]">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "grayscale(1) contrast(1.05)" }} />
					</div>
					<div className="relative h-52 overflow-hidden bg-[#fafafa]">
						<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "grayscale(1) contrast(1.05)" }} />
					</div>
				</div>
			</section>

			{/* Mirror philosophy */}
			<section id="mirror" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-3xl text-center">
					<div className="mx-auto mb-6 h-16 w-px bg-[#0a0a0a10]" />
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.8rem)] font-bold leading-[1.35] tracking-[-0.02em]">
						Was sich perfekt spiegelt, hat keine Fehler.
					</blockquote>
					{/* Reflected quote */}
					<div
						className="mt-2 text-[clamp(1.5rem,3.5vw,2.8rem)] font-bold leading-[1.35] tracking-[-0.02em]"
						style={{
							opacity: 0.04,
							transform: "scaleY(-1)",
							maskImage: "linear-gradient(180deg, rgba(0,0,0,0.5), transparent)",
							WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,0.5), transparent)",
						}}
					>
						Was sich perfekt spiegelt, hat keine Fehler.
					</div>
					<div className="mx-auto mt-8 h-16 w-px bg-[#0a0a0a10]" />
				</div>
			</section>

			{/* Contact — clean symmetrical */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16" style={{ backgroundColor: "#0a0a0a", color: "#fafafa" }}>
				<div className="mx-auto max-w-3xl text-center">
					<h2 className="mb-4 text-4xl font-bold tracking-[-0.03em]">
						Bereit f&uuml;r Klarheit?
					</h2>
					<p className="mb-10 text-[14px] leading-relaxed text-[#fafafa50]">
						Erleben Sie Z8 &mdash; so transparent wie ein perfekter Spiegel.
					</p>
					<div className="flex items-center justify-center gap-4">
						<a
							href="mailto:hello@z8.app"
							className="px-10 py-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#0a0a0a] transition-all hover:bg-[#e0e0e0]"
							style={{ backgroundColor: "#fafafa" }}
						>
							Demo vereinbaren
						</a>
						<a href="mailto:hello@z8.app" className="px-6 py-4 text-[11px] tracking-[0.1em] text-[#fafafa40] transition-colors hover:text-[#fafafa]">
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16">
				<div className="flex items-center justify-between text-[10px] tracking-[0.2em] text-[#0a0a0a25]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#0a0a0a]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
